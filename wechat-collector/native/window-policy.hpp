#pragma once
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>

namespace collector {
inline void require(bool condition, const char* error) { if (!condition) throw std::runtime_error(error); }
struct Value { bool text; std::string value; };

// Deliberately NOT a general JSON parser: accepts only this private, flat ASCII
// protocol. Escaped strings, unknown keys, duplicate keys and coercions fail closed.
class Parser {
    const std::string& raw;
    size_t pos = 0;
    static bool digit(char c) { return c >= '0' && c <= '9'; }
    void space() { while (pos < raw.size() && (raw[pos] == ' ' || raw[pos] == '\n' || raw[pos] == '\r' || raw[pos] == '\t')) ++pos; }
    bool take(char c) { space(); if (pos < raw.size() && raw[pos] == c) { ++pos; return true; } return false; }
    std::string string() {
        require(take('"'), "invalid_request");
        const auto start = pos;
        while (pos < raw.size() && raw[pos] != '"') {
            const auto c = static_cast<unsigned char>(raw[pos++]);
            require(c >= 0x20 && c < 0x7f && c != '\\', "invalid_request");
        }
        require(pos < raw.size(), "invalid_request");
        return raw.substr(start, pos++ - start);
    }
    Value value() {
        space();
        require(pos < raw.size(), "invalid_request");
        if (raw[pos] == '"') return {true, string()};
        const auto start = pos;
        if (raw[pos] == '-') ++pos;
        require(pos < raw.size() && digit(raw[pos]), "invalid_request");
        if (raw[pos] == '0') ++pos;
        else while (pos < raw.size() && digit(raw[pos])) ++pos;
        if (pos < raw.size() && raw[pos] == '.') {
            ++pos; require(pos < raw.size() && digit(raw[pos]), "invalid_request");
            while (pos < raw.size() && digit(raw[pos])) ++pos;
        }
        if (pos < raw.size() && (raw[pos] == 'e' || raw[pos] == 'E')) {
            ++pos;
            if (pos < raw.size() && (raw[pos] == '+' || raw[pos] == '-')) ++pos;
            require(pos < raw.size() && digit(raw[pos]), "invalid_request");
            while (pos < raw.size() && digit(raw[pos])) ++pos;
        }
        return {false, raw.substr(start, pos - start)};
    }
public:
    explicit Parser(const std::string& input): raw(input) {}
    std::map<std::string, Value> parse() {
        require(!raw.empty() && raw.size() < 4096 && take('{'), "invalid_request");
        std::map<std::string, Value> values;
        do {
            const auto key = string();
            require(key == "windowId" || key == "action" || key == "x" || key == "y" || key == "ratio" || key == "scrollFraction", "invalid_request");
            require(take(':'), "invalid_request");
            require(values.emplace(key, value()).second, "invalid_request");
        } while (take(','));
        require(take('}'), "invalid_request"); space();
        require(pos == raw.size(), "invalid_request");
        return values;
    }
};

struct Request {
    uint64_t id;
    std::string action;
    double x = 0, y = 0, ratio = 0, fraction = 0;
};
inline Request parseRequest(const std::string& raw) {
    const auto fields = Parser(raw).parse();
    const auto text = [&](const char* key) {
        const auto it = fields.find(key);
        require(it != fields.end() && it->second.text, "invalid_request");
        return it->second.value;
    };
    const auto number = [&](const char* key) {
        const auto it = fields.find(key);
        require(it != fields.end() && !it->second.text, "invalid_request");
        char* end = nullptr;
        const auto n = std::strtod(it->second.value.c_str(), &end);
        require(end && *end == '\0' && std::isfinite(n), "invalid_request");
        return n;
    };
    const auto id = text("windowId"), action = text("action");
    require(action == "inspect" || action == "focus" || action == "activate" || action == "up" || action == "down", "invalid_request");
    require(!id.empty() && id.front() != '0' && id.size() <= 20, "invalid_request");
    uint64_t handle = 0;
    for (const char c : id) {
        require(c >= '0' && c <= '9', "invalid_request");
        const auto digit = static_cast<unsigned>(c - '0');
        require(handle <= (std::numeric_limits<uintptr_t>::max() - digit) / 10, "invalid_request");
        handle = handle * 10 + digit;
    }
    Request result{handle, action};
    require(fields.size() == (action == "inspect" ? 2 : 6), "invalid_request");
    if (action != "inspect") {
        result.x = number("x"); result.y = number("y"); result.ratio = number("ratio"); result.fraction = number("scrollFraction");
        require(result.x > 0 && result.x < 1 && result.y > 0 && result.y < 1 && result.ratio > 0, "invalid_request");
        require(result.fraction > 0 && result.fraction <= 0.8, "invalid_request");
        require(action != "activate" || result.x < 0.5, "entry_not_left");
    }
    return result;
}

struct Window { uint64_t id, pid; int x, y, width, height; bool trusted; };
struct Point { int x, y; };
inline bool sameWindow(const Window& a, const Window& b) {
    return a.id == b.id && a.pid == b.pid && a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
}
template<class Send> void sendMouse(bool click, Send send) {
    const unsigned count = click ? 2 : 1;
    const auto sent = send(count, false);
    // A partial click must not leave the left button held. Never retry a click
    // or wheel event; release only our own partial mouse-down, then report failure.
    if (click && sent == 1) send(1, true);
    require(sent == count, "input_blocked");
}

// Driver must verify process ownership, visibility and supported coordinates on
// every inspect, and recheck target/foreground/hit-testing immediately before input.
template<class Driver> Window execute(const Request& request, Driver& driver) {
    const auto window = driver.inspect(request.id);
    require(window.id == request.id && window.pid != 0 && window.width >= 300 && window.height >= 300 && window.width <= 32768 && window.height <= 32768 && std::abs(static_cast<double>(window.x)) <= 1000000 && std::abs(static_cast<double>(window.y)) <= 1000000, "invalid_window");
    if (request.action == "inspect") return window;
    require(window.trusted, "control_blocked");
    require(std::abs(static_cast<double>(window.width) / window.height - request.ratio) < 0.015, "geometry_changed");
    if (request.action == "activate" || request.action == "focus") driver.activate(window);
    require(sameWindow(window, driver.inspect(request.id)), "window_changed");
    const Point point{window.x + static_cast<int>(window.width * request.x), window.y + static_cast<int>(window.height * request.y)};
    driver.checkPoint(window, point);
    if (request.action == "activate") driver.click(window, point);
    else if (request.action != "focus") {
        // Respect the calibrated ROI fraction; bounded wheel ticks, not arbitrary scrolling.
        const int ticks = static_cast<int>(std::ceil(request.fraction * 4));
        driver.scroll(window, point, (request.action == "up" ? 1 : -1) * 120 * ticks);
    }
    require(sameWindow(window, driver.inspect(request.id)), "window_changed");
    return window;
}
}
