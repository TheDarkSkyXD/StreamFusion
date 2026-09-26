import ApplicationServices
import AppKit
import CoreGraphics
import Darwin
import Foundation

let maximumElements = 1_500
let maximumDepth = 32

struct SnapshotRow {
    let role: String
    let name: String
    let description: String
    let value: String
    let placeholder: String

    var text: String {
        [role, name, description, value, placeholder]
            .map { $0.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ") }
            .joined(separator: "\t")
    }
}

struct PendingElement {
    let element: AXUIElement
    let depth: Int
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func copyAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String {
    copyAttribute(element, name) as? String ?? ""
}

func elementArrayAttribute(_ element: AXUIElement, _ name: String) -> [AXUIElement] {
    copyAttribute(element, name) as? [AXUIElement] ?? []
}

func sizeAttribute(_ element: AXUIElement) -> CGSize? {
    guard let value = copyAttribute(element, "AXSize"), CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }
    var size = CGSize.zero
    guard AXValueGetValue(value as! AXValue, .cgSize, &size) else { return nil }
    return size
}

func ownedWindowIds(pid: pid_t) -> [CGWindowID] {
    guard let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return []
    }
    return windows
        .compactMap { window -> CGWindowID? in
            guard
                (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                let number = window[kCGWindowNumber as String] as? NSNumber,
                let bounds = window[kCGWindowBounds as String] as? [String: Any],
                let rectangle = CGRect(dictionaryRepresentation: bounds as CFDictionary),
                rectangle.width > 0,
                rectangle.height > 0
            else {
                return nil
            }
            return number.uint32Value
        }
}

func titleRow(_ element: AXUIElement, role: String) -> SnapshotRow {
    SnapshotRow(
        role: role,
        name: stringAttribute(element, "AXTitle"),
        description: "",
        value: "",
        placeholder: ""
    )
}

func matchingRow(
    _ element: AXUIElement,
    role: String,
    label: String,
    attributes: [String]
) -> SnapshotRow? {
    let values = Dictionary(uniqueKeysWithValues: attributes.map { ($0, stringAttribute(element, $0)) })
    guard values.values.contains(where: { $0.contains(label) }) else { return nil }
    return SnapshotRow(
        role: role,
        name: values["AXTitle"] ?? "",
        description: values["AXDescription"] ?? "",
        value: values["AXValue"] ?? "",
        placeholder: values["AXPlaceholderValue"] ?? ""
    )
}

func emit(_ rows: [SnapshotRow]) {
    print(rows.map(\.text).joined(separator: "\n"))
}

let arguments = ProcessInfo.processInfo.arguments
guard arguments.count == 3, let requestedPid = pid_t(arguments[1]), requestedPid > 0 else {
    fail("Usage: verify-start-package-macos-ax <pid> <probe|shellSnapshot|settings|settingsSnapshot>")
}
let action = arguments[2]
guard ["probe", "shellSnapshot", "settings", "settingsSnapshot"].contains(action) else {
    fail("Unknown native accessibility action: \(action)")
}
guard AXIsProcessTrusted() else {
    fail("Native accessibility permission unavailable: AXIsProcessTrusted=false")
}

let systemWideElement = AXUIElementCreateSystemWide()
_ = AXUIElementSetMessagingTimeout(systemWideElement, 0.5)
let application = AXUIElementCreateApplication(requestedPid)
var observedPid: pid_t = 0
guard AXUIElementGetPid(application, &observedPid) == .success, observedPid == requestedPid else {
    fail("Native accessibility adapter could not confirm the owned process")
}
guard let window = elementArrayAttribute(application, "AXWindows").first else {
    fail("Owned application has no native accessibility window")
}

if action == "probe" {
    guard let runningApplication = NSRunningApplication(processIdentifier: requestedPid) else {
        fail("Owned application is not available for native activation")
    }
    guard runningApplication.activate(options: [.activateAllWindows, .activateIgnoringOtherApps]) else {
        fail("Owned application native activation was rejected")
    }
    var requestedSize = CGSize(width: 1_024, height: 768)
    guard
        let requestedSizeValue = AXValueCreate(.cgSize, &requestedSize),
        AXUIElementSetAttributeValue(window, "AXSize" as CFString, requestedSizeValue) == .success
    else {
        fail("Owned native window resize was rejected")
    }
    var actualSize = sizeAttribute(window)
    for _ in 0..<40 {
        if actualSize?.width == 1_024 { break }
        Thread.sleep(forTimeInterval: 0.05)
        actualSize = sizeAttribute(window)
    }
    guard let actualSize, actualSize.width == 1_024 else {
        fail("Owned native window resize pending: \(actualSize?.width ?? 0)x\(actualSize?.height ?? 0)")
    }
    let windowIds = ownedWindowIds(pid: requestedPid)
    guard !windowIds.isEmpty else {
        fail("Owned application window ID is not available")
    }
    guard windowIds.count == 1, let windowId = windowIds.first else {
        fail("Owned application window identity is ambiguous: \(windowIds.count) candidates")
    }
    emit([
        SnapshotRow(role: "AXProbe", name: "ApplicationServices", description: "", value: "true", placeholder: ""),
        SnapshotRow(role: "AXWindow", name: stringAttribute(window, "AXTitle"), description: "", value: "", placeholder: ""),
        SnapshotRow(role: "AXWindowSize", name: "", description: "", value: "\(Int(actualSize.width))x\(Int(actualSize.height))", placeholder: ""),
        SnapshotRow(role: "AXWindowID", name: "", description: "", value: String(windowId), placeholder: ""),
    ])
    exit(0)
}

let windowRow = SnapshotRow(
    role: "AXWindow",
    name: stringAttribute(window, "AXTitle"),
    description: "",
    value: "",
    placeholder: ""
)
var pending = [PendingElement(element: window, depth: 0)]
var cursor = 0
var webAreaRow: SnapshotRow?
var settingsRow: SnapshotRow?
var searchRow: SnapshotRow?
var settingsDescriptionRow: SnapshotRow?
var settingsContentRow: SnapshotRow?
var settingsCurrentRow: SnapshotRow?

while cursor < pending.count, cursor < maximumElements {
    let current = pending[cursor]
    cursor += 1
    let role = stringAttribute(current.element, "AXRole")

    if action == "shellSnapshot" {
        if webAreaRow == nil, role == "AXWebArea" {
            webAreaRow = titleRow(current.element, role: role)
        } else if settingsRow == nil, ["AXLink", "AXButton"].contains(role) {
            settingsRow = matchingRow(
                current.element,
                role: role,
                label: "Settings",
                attributes: ["AXTitle", "AXDescription", "AXValue"]
            )
        } else if searchRow == nil, ["AXTextField", "AXTextArea"].contains(role) {
            searchRow = matchingRow(
                current.element,
                role: role,
                label: "Search Twitch and Kick",
                attributes: ["AXPlaceholderValue", "AXTitle", "AXDescription", "AXValue"]
            )
        }
        if let webAreaRow, let settingsRow, let searchRow {
            emit([windowRow, webAreaRow, settingsRow, searchRow])
            exit(0)
        }
    } else if action == "settings" {
        if ["AXLink", "AXButton"].contains(role),
           matchingRow(
               current.element,
               role: role,
               label: "Settings",
               attributes: ["AXTitle", "AXDescription", "AXValue"]
           ) != nil {
            let result = AXUIElementPerformAction(current.element, "AXPress" as CFString)
            guard result == .success else {
                fail("Native Settings AXPress failed with AXError \(result.rawValue)")
            }
            print("Settings pressed")
            exit(0)
        }
    } else {
        if settingsCurrentRow == nil, ["AXLink", "AXButton"].contains(role),
           let candidate = matchingRow(
               current.element,
               role: role,
               label: "Settings",
               attributes: ["AXTitle", "AXDescription"]
           ),
           stringAttribute(current.element, "AXARIACurrent") == "page" {
            settingsCurrentRow = SnapshotRow(
                role: candidate.role,
                name: candidate.name,
                description: candidate.description,
                value: "page",
                placeholder: ""
            )
        } else if ["AXStaticText", "AXHeading"].contains(role) {
            settingsDescriptionRow = settingsDescriptionRow ?? matchingRow(
                current.element,
                role: role,
                label: "Personalize your StreamFusion experience",
                attributes: ["AXValue", "AXTitle", "AXDescription"]
            )
            settingsContentRow = settingsContentRow ?? matchingRow(
                current.element,
                role: role,
                label: "Default Quality",
                attributes: ["AXValue", "AXTitle", "AXDescription"]
            )
        } else if searchRow == nil, ["AXTextField", "AXTextArea"].contains(role) {
            searchRow = matchingRow(
                current.element,
                role: role,
                label: "Search settings",
                attributes: ["AXPlaceholderValue", "AXTitle", "AXDescription", "AXValue"]
            )
        }
    }

    if action == "settingsSnapshot", let settingsCurrentRow, let settingsDescriptionRow, let searchRow, let settingsContentRow {
        emit([windowRow, settingsCurrentRow, settingsDescriptionRow, searchRow, settingsContentRow])
        exit(0)
    }

    if current.depth < maximumDepth, pending.count < maximumElements {
        let remainingCapacity = maximumElements - pending.count
        pending.append(
            contentsOf: elementArrayAttribute(current.element, "AXChildren")
                .prefix(remainingCapacity)
                .map { PendingElement(element: $0, depth: current.depth + 1) }
        )
    }
}

if action == "shellSnapshot" {
    emit([windowRow, webAreaRow, settingsRow, searchRow].compactMap { $0 })
} else if action == "settingsSnapshot" {
    emit([windowRow, settingsCurrentRow, settingsDescriptionRow, searchRow, settingsContentRow].compactMap { $0 })
} else {
    fail("Required Settings accessibility target not found after \(cursor) elements")
}
