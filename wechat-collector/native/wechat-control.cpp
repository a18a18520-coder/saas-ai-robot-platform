#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <dwmapi.h>
#include <iostream>
#include <vector>
#include "window-policy.hpp"

using namespace collector;

class Handle {
    HANDLE value;
public:
    explicit Handle(HANDLE handle): value(handle) {}
    ~Handle() { if (value) CloseHandle(value); }
    operator HANDLE() const { return value; }
};

bool canControl(HANDLE owner) {
    // No elevation, impersonation, UIAccess, or UIPI bypass. A higher-integrity
    // WeChat can still be inspected; automation stays disabled.
    auto integrity = [](HANDLE process) -> DWORD {
        HANDLE raw = nullptr;
        if (!OpenProcessToken(process, TOKEN_QUERY, &raw)) return 0;
        Handle token(raw);
        DWORD size = 0;
        GetTokenInformation(token, TokenIntegrityLevel, nullptr, 0, &size);
        if (!size || size > 65536) return 0;
        std::vector<unsigned char> bytes(size);
        if (!GetTokenInformation(token, TokenIntegrityLevel, bytes.data(), size, &size)) return 0;
        const auto sid = reinterpret_cast<TOKEN_MANDATORY_LABEL*>(bytes.data())->Label.Sid;
        return *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
    };
    const auto target = integrity(owner), own = integrity(GetCurrentProcess());
    return target != 0 && own != 0 && target <= own;
}

class WindowsDriver {
public:
    Window inspect(uint64_t id) {
        const auto handle = reinterpret_cast<HWND>(static_cast<uintptr_t>(id));
        require(IsWindow(handle) && IsWindowVisible(handle) && !IsIconic(handle) && IsWindowEnabled(handle) && GetAncestor(handle, GA_ROOT) == handle, "invalid_window");
        DWORD pid = 0;
        require(GetWindowThreadProcessId(handle, &pid) && pid != 0, "invalid_window");
        Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
        require(process != nullptr, "invalid_window");
        wchar_t executable[32768]; DWORD length = 32768;
        require(QueryFullProcessImageNameW(process, 0, executable, &length), "invalid_window");
        const std::wstring filename(executable, length);
        const auto base = filename.substr(filename.find_last_of(L"\\/") + 1);
        require(_wcsicmp(base.c_str(), L"WeChat.exe") == 0 || _wcsicmp(base.c_str(), L"Weixin.exe") == 0, "not_wechat");
        DWORD cloaked = 0;
        require(SUCCEEDED(DwmGetWindowAttribute(handle, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && !cloaked, "invalid_window");
        RECT rect{};
        // Physical visible bounds, excluding invisible resize borders.
        require(SUCCEEDED(DwmGetWindowAttribute(handle, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect))), "invalid_window");
        const auto width = static_cast<int64_t>(rect.right) - rect.left, height = static_cast<int64_t>(rect.bottom) - rect.top;
        require(width >= 300 && height >= 300 && width <= 32768 && height <= 32768, "invalid_window");
        return {id, pid, rect.left, rect.top, static_cast<int>(width), static_cast<int>(height), canControl(process)};
    }
    void activate(const Window& window) {
        const auto handle = reinterpret_cast<HWND>(static_cast<uintptr_t>(window.id));
        require(SetForegroundWindow(handle) || GetForegroundWindow() == handle, "not_foreground");
        Sleep(250);
    }
    void checkPoint(const Window& window, const Point& point) {
        const auto current = inspect(window.id);
        require(sameWindow(window, current), "window_changed");
        require(current.trusted, "control_blocked");
        const auto handle = reinterpret_cast<HWND>(static_cast<uintptr_t>(window.id));
        require(GetForegroundWindow() == handle, "not_foreground");
        require(GetAncestor(WindowFromPoint({point.x, point.y}), GA_ROOT) == handle, "window_covered");
        // Do not combine the collector's action with held modifiers or a user's drag.
        for (const int key : {VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN, VK_LBUTTON, VK_RBUTTON, VK_MBUTTON})
            require(!(GetAsyncKeyState(key) & 0x8000), "user_input_active");
    }
    void input(const Window& window, const Point& point, bool click, int delta) {
        checkPoint(window, point);
        require(SetCursorPos(point.x, point.y), "input_blocked");
        checkPoint(window, point);
        POINT current{};
        require(GetCursorPos(&current) && current.x == point.x && current.y == point.y, "user_input_active");
        INPUT events[2]{};
        events[0].type = INPUT_MOUSE;
        events[0].mi.dwFlags = click ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_WHEEL;
        events[0].mi.mouseData = click ? 0 : static_cast<DWORD>(delta);
        events[1].type = INPUT_MOUSE; events[1].mi.dwFlags = MOUSEEVENTF_LEFTUP;
        sendMouse(click, [&](unsigned count, bool releaseOnly) { return SendInput(count, releaseOnly ? &events[1] : events, sizeof(INPUT)); });
    }
    void click(const Window& window, const Point& point) { input(window, point, true, 0); }
    void scroll(const Window& window, const Point& point, int delta) { input(window, point, false, delta); }
};

int main() {
    try {
        // Bounded input before parsing; no command line paths, shell or script engine.
        std::string raw; char c;
        while (std::cin.get(c)) { raw.push_back(c); require(raw.size() < 4096, "invalid_request"); }
        const auto request = parseRequest(raw);
        require(SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2), "dpi_unavailable");
        WindowsDriver driver;
        const auto w = execute(request, driver);
        std::cout << "{\"ok\":true,\"protocolVersion\":1,\"windowId\":\"" << request.id
                  << "\",\"trusted\":" << (w.trusted ? "true" : "false") << ",\"x\":" << w.x << ",\"y\":" << w.y
                  << ",\"width\":" << w.width << ",\"height\":" << w.height << "}";
        return 0;
    } catch (const std::runtime_error& error) {
        // Only fixed internal error codes, never paths or chat content.
        std::cout << "{\"ok\":false,\"error\":\"" << error.what() << "\"}";
        return 1;
    } catch (...) { std::cout << "{\"ok\":false,\"error\":\"native_failure\"}"; return 1; }
}
