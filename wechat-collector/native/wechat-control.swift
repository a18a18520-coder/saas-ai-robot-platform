import Foundation
import AppKit
import ApplicationServices

// Restricted bridge: one explicit WeChat window, left click or wheel only.
// No keyboard entry, clipboard, process injection, databases or message sending.
func fail(_ message: String) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: ["ok": false, "error": message])
    FileHandle.standardOutput.write(data); exit(1)
}
let bytes = FileHandle.standardInput.readDataToEndOfFile()
guard bytes.count < 4096,
      let input = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any]
else { fail("窗口操作参数无效") }
if input["action"] as? String == "permissions" {
    guard input.count == 1 else { fail("权限检查参数无效") }
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ["ok": true, "protocolVersion": 1, "kind": "permissions", "trusted": AXIsProcessTrusted()]))
    exit(0)
}
guard
      let idText = input["windowId"] as? String, let windowID = UInt32(idText),
      let action = input["action"] as? String, ["inspect", "focus", "activate", "up", "down"].contains(action)
else { fail("窗口操作参数无效") }
guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow, .excludeDesktopElements], windowID) as? [[String: Any]],
      let info = list.first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowID }),
      let pid = info[kCGWindowOwnerPID as String] as? Int32,
      let application = NSRunningApplication(processIdentifier: pid),
      application.bundleIdentifier == "com.tencent.xinWeChat",
      let dictionary = info[kCGWindowBounds as String] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: dictionary), bounds.width > 300, bounds.height > 300,
      (info[kCGWindowIsOnscreen as String] as? Bool) == true
else { fail("目标不是可见的微信窗口，请重新选择；不能操作其他应用") }
let trusted = AXIsProcessTrusted()
if action != "inspect" {
    guard trusted else { fail("请在系统设置 → 隐私与安全 → 辅助功能中允许 WeChat Collector，然后重新启动") }
    guard let x = input["x"] as? Double, let y = input["y"] as? Double,
          x.isFinite, y.isFinite, x > 0, x < 1, y > 0, y < 1,
          let ratio = input["ratio"] as? Double, ratio.isFinite,
          abs(bounds.width / bounds.height - ratio) < 0.015
    else { fail("窗口尺寸或操作区域已改变，请重新校准") }
    // Validate before activation, pointer movement or any input event.
    guard let fraction = input["scrollFraction"] as? Double, fraction.isFinite, fraction > 0, fraction <= 0.8 else { fail("滚动距离无效") }
    if action == "activate" || action == "focus" {
        guard action == "focus" || x < 0.5 else { fail("只允许点击微信左侧会话入口") }
        application.activate(options: [])
        Thread.sleep(forTimeInterval: 0.25)
    }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { fail("微信不在前台，已暂停；请勿在轮巡时操作其他窗口") }
    let point = CGPoint(x: bounds.minX + bounds.width * x, y: bounds.minY + bounds.height * y)
    // Do not click or scroll through another window covering the calibrated target.
    let system = AXUIElementCreateSystemWide()
    var element: AXUIElement?
    guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &element) == .success,
          let element = element else { fail("无法确认鼠标位置所属应用，已暂停") }
    var owner: pid_t = 0
    guard AXUIElementGetPid(element, &owner) == .success, owner == pid else { fail("微信被其他窗口遮挡，已暂停") }
    var targetWindow: CFTypeRef?
    var elementRole: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &elementRole) == .success,
       (elementRole as? String) == (kAXWindowRole as String) { targetWindow = element }
    else { _ = AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &targetWindow) }
    guard
          let targetWindow = targetWindow, CFGetTypeID(targetWindow) == AXUIElementGetTypeID()
    else { fail("无法确认操作属于已选择的微信窗口，已暂停") }
    let axWindow = targetWindow as! AXUIElement
    var positionValue: CFTypeRef?, sizeValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axWindow, kAXPositionAttribute as CFString, &positionValue) == .success,
          AXUIElementCopyAttributeValue(axWindow, kAXSizeAttribute as CFString, &sizeValue) == .success,
          let positionValue = positionValue, let sizeValue = sizeValue,
          CFGetTypeID(positionValue) == AXValueGetTypeID(), CFGetTypeID(sizeValue) == AXValueGetTypeID()
    else { fail("无法校验目标窗口位置，已暂停") }
    var axPosition = CGPoint.zero, axSize = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &axPosition),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &axSize),
          abs(axPosition.x - bounds.minX) < 2, abs(axPosition.y - bounds.minY) < 2,
          abs(axSize.width - bounds.width) < 2, abs(axSize.height - bounds.height) < 2
    else { fail("操作位置属于其他微信窗口或弹窗，已暂停") }
    let source = CGEventSource(stateID: .hidSystemState)
    if action == "activate" {
        CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    } else if action != "focus" {
        let delta = Int32(min(700, max(40, bounds.height * fraction))) * (action == "up" ? 1 : -1)
        let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)
        event?.location = point; event?.post(tap: .cghidEventTap)
    }
}
let result: [String: Any] = ["ok": true, "protocolVersion": 1, "windowId": idText, "trusted": trusted, "x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: result))
