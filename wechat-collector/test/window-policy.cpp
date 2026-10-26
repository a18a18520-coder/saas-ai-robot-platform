#include "../native/window-policy.hpp"
#include <iostream>
#include <vector>
#include <functional>
using namespace collector;
static int passed = 0;
void check(bool condition) { if (!condition) throw std::logic_error("test assertion failed"); }
void rejected(const std::function<void()>& fn, const std::string& code = "") {
    try { fn(); } catch (const std::runtime_error& error) { check(code.empty() || error.what() == code); return; }
    throw std::logic_error("expected rejection");
}
void test(const char* name, const std::function<void()>& fn) { fn(); ++passed; std::cout << "PASS " << name << '\n'; }
const std::string inspect = R"({"windowId":"123","action":"inspect"})";
std::string operation(std::string action = "activate") {
    return "{\"windowId\":\"123\",\"action\":\"" + action + "\",\"x\":0.2,\"y\":0.4,\"ratio\":1.25,\"scrollFraction\":0.4}";
}
struct Fake {
    Window w{123, 500, -1000, 40, 1000, 800, true};
    int inspections = 0, active = 0, clickCount = 0, scrollCount = 0, delta = 0, pointChecks = 0;
    bool covered = false, foreground = true, held = false, moved = false, replaced = false, hidden = false;
    Point last{};
    Window inspect(uint64_t id) {
        require(!hidden && id == w.id, "invalid_window"); ++inspections;
        auto result = w;
        if (inspections > 1 && moved) result.x += 1;
        if (inspections > 1 && replaced) result.pid += 1;
        return result;
    }
    void activate(const Window&) { ++active; }
    void checkPoint(const Window&, Point point) {
        ++pointChecks; require(foreground, "not_foreground"); require(!covered, "window_covered"); require(!held, "user_input_active"); last = point;
    }
    void click(const Window&, Point) { ++clickCount; }
    void scroll(const Window&, Point, int n) { ++scrollCount; delta = n; }
    int inputs() const { return clickCount + scrollCount; }
};
int main() {
    try {
        test("inspect accepts exact protocol without UI input", [] { Fake f; const auto r = execute(parseRequest(inspect), f); check(r.pid == 500 && f.inspections == 1 && !f.inputs() && !f.active); });
        test("all non-whitelisted actions rejected", [] { for (const auto* action : {"send", "type", "key", "paste", "shell", "INSPECT"}) rejected([&] { parseRequest(operation(action)); }); });
        test("invalid JSON and extra structure rejected", [] { for (const auto* raw : {"", "{}", "[]", "null", "{}{}", "{\"action\":true}", "{\"windowId\":{}}", "{\"action\":\"inspect\",}", "{\"windowId\":\"123\",\"action\":\"inspect\",\"file\":\"x\"}"}) rejected([&] { parseRequest(raw); }); });
        test("oversized and trailing input rejected", [] { rejected([] { parseRequest(std::string(4096, ' ')); }); rejected([] { parseRequest(inspect + "x"); }); rejected([] { parseRequest(inspect + std::string(1, '\0')); }); });
        test("duplicate keys rejected", [] { rejected([] { parseRequest(R"({"windowId":"123","action":"inspect","action":"activate"})"); }); });
        test("escaped strings rejected instead of interpreted", [] { rejected([] { parseRequest(R"({"windowId":"123","action":"\u0069nspect"})"); }); });
        test("window IDs are canonical and bounded", [] { for (const auto* id : {"0", "01", "-1", "1.0", "1e2", " 123", "18446744073709551616"}) rejected([&] { parseRequest("{\"windowId\":\"" + std::string(id) + "\",\"action\":\"inspect\"}"); }); check(parseRequest(R"({"windowId":"18446744073709551615","action":"inspect"})").id == UINT64_MAX); });
        test("finite JSON numbers only", [] { for (const auto* value : {"\"0.2\"", "null", "true", "NaN", "Infinity", "1e999", "01", "+0.2", ".2", "0.", "0.2e"}) { auto raw = operation(); raw.replace(raw.find("0.2"), 3, value); rejected([&] { parseRequest(raw); }); } });
        test("missing coordinates and inspect extras rejected", [] { rejected([] { parseRequest(R"({"windowId":"123","action":"up"})"); }); rejected([] { parseRequest(R"({"windowId":"123","action":"inspect","x":0.2})"); }); });
        test("out of range coordinates rejected before any driver call", [] { for (const auto* value : {"0", "-0.1", "1", "1.1"}) { auto raw = operation(); raw.replace(raw.find("0.2"), 3, value); Fake f; rejected([&] { execute(parseRequest(raw), f); }); check(!f.inspections && !f.active && !f.inputs()); } });
        test("right side clicks rejected before activation", [] { auto raw = operation(); raw.replace(raw.find("0.2"), 3, "0.5"); Fake f; rejected([&] { execute(parseRequest(raw), f); }, "entry_not_left"); check(!f.inspections && !f.active && !f.inputs()); });
        test("invalid scroll fraction rejected before activation too", [] { for (const auto* value : {"0", "-1", "0.81", "1e999"}) { auto raw = operation(); raw.replace(raw.rfind("0.4"), 3, value); Fake f; rejected([&] { execute(parseRequest(raw), f); }); check(!f.inspections && !f.active && !f.inputs()); } });
        test("permission failure allows inspection only", [] { Fake f; f.w.trusted = false; check(!execute(parseRequest(inspect), f).trusted); rejected([&] { execute(parseRequest(operation()), f); }, "control_blocked"); check(!f.active && !f.inputs()); });
        test("geometry change rejected before activation", [] { Fake f; f.w.width = 1200; rejected([&] { execute(parseRequest(operation()), f); }, "geometry_changed"); check(!f.active && !f.inputs()); });
        test("window movement pauses after activation", [] { Fake f; f.moved = true; rejected([&] { execute(parseRequest(operation()), f); }, "window_changed"); check(f.active == 1 && !f.inputs()); });
        test("reused handle with different PID never gets input", [] { Fake f; f.replaced = true; rejected([&] { execute(parseRequest(operation()), f); }, "window_changed"); check(!f.inputs()); });
        test("hidden window never activated", [] { Fake f; f.hidden = true; rejected([&] { execute(parseRequest(operation()), f); }, "invalid_window"); check(!f.active && !f.inputs()); });
        test("extreme window geometry rejected before coordinate arithmetic", [] { Fake f; f.w.x = std::numeric_limits<int>::max(); rejected([&] { execute(parseRequest(operation()), f); }, "invalid_window"); check(!f.active && !f.inputs()); });
        test("partial click releases only its own mouse-down and still fails", [] { int calls = 0; rejected([&] { sendMouse(true, [&](unsigned count, bool releaseOnly) { ++calls; check(calls == 1 ? (count == 2 && !releaseOnly) : (count == 1 && releaseOnly)); return 1u; }); }, "input_blocked"); check(calls == 2); });
        test("blocked click or wheel is never blindly retried", [] { for (const bool click : {true, false}) { int calls = 0; rejected([&] { sendMouse(click, [&](unsigned, bool releaseOnly) { ++calls; check(!releaseOnly); return 0u; }); }, "input_blocked"); check(calls == 1); } });
        test("covered target gets no mouse event", [] { Fake f; f.covered = true; rejected([&] { execute(parseRequest(operation()), f); }, "window_covered"); check(!f.inputs()); });
        test("background window is not scrolled", [] { Fake f; f.foreground = false; rejected([&] { execute(parseRequest(operation("up")), f); }, "not_foreground"); check(!f.active && !f.inputs()); });
        test("held modifier or user drag pauses", [] { Fake f; f.held = true; rejected([&] { execute(parseRequest(operation("up")), f); }, "user_input_active"); check(!f.inputs()); });
        test("left click exact target with negative screen origin", [] { Fake f; execute(parseRequest(operation()), f); check(f.active == 1 && f.clickCount == 1 && f.scrollCount == 0 && f.last.x == -800 && f.last.y == 360 && f.inspections == 3); });
        test("focus activates only the chosen window without clicking or scrolling", [] { Fake f; execute(parseRequest(operation("focus")), f); check(f.active == 1 && f.clickCount == 0 && f.scrollCount == 0 && f.inspections == 3); });
        test("scroll direction and fraction are bounded", [] { for (const auto* action : {"up", "down"}) { Fake f; execute(parseRequest(operation(action)), f); check(f.scrollCount == 1 && f.clickCount == 0 && f.active == 0 && f.delta == (std::string(action) == "up" ? 240 : -240)); } });
        test("whitespace and finite exponent accepted", [] { auto raw = operation(); raw.replace(raw.find("0.2"), 3, "2e-1"); check(parseRequest(" \n" + raw + "\t\r").x == 0.2); });
        test("fuzz bounded ASCII input never reaches UI driver", [] { uint32_t seed = 20261025; for (int i = 0; i < 5000; ++i) { std::string raw; for (int j = 0; j < i % 200; ++j) { seed = seed * 1664525u + 1013904223u; raw.push_back(static_cast<char>(seed >> 24)); } rejected([&] { parseRequest(raw); }); } });
        std::cout << passed << " native policy cases passed (synthetic driver, no real UI).\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << "FAIL after " << passed << " cases: " << error.what() << '\n'; return 1; }
}
