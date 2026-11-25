import ActivityKit
import React
import UIKit

@objc(DshRemoteLiveTask)
final class RemoteLiveTask: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(update:resolve:reject:)
  func update(_ value: NSDictionary, resolve: @escaping RCTPromiseResolveBlock,
              reject: @escaping RCTPromiseRejectBlock) {
    guard let host = value["host"] as? String, let session = value["session"] as? String,
          !host.isEmpty, !session.isEmpty, let phase = value["phase"] as? String else {
      resolve(nil)
      return
    }
    let ms = value["started"] as? Double ?? 0
    let date = Date(timeIntervalSince1970: ms / 1000)
    let state = RemoteTaskAttributes.ContentState(
      title: String((value["title"] as? String ?? "DSH Remote").prefix(100)),
      phase: phase, badge: value["badge"] as? String ?? "D", waiting: value["waiting"] as? Bool ?? false,
      started: ms > 0 && date <= Date() ? date : nil, count: value["count"] as? String ?? "",
      paused: value["paused"] as? String ?? "DSH Remote", host: host, session: session)
    Task { @MainActor in
      let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(180))
      var current: Activity<RemoteTaskAttributes>?
      for activity in Activity<RemoteTaskAttributes>.activities {
        if current == nil && (activity.activityState == .active || activity.activityState == .stale) {
          current = activity
        } else {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      if let current {
        await current.update(content)
      } else if UIApplication.shared.applicationState == .active && ActivityAuthorizationInfo().areActivitiesEnabled {
        do {
          _ = try Activity.request(attributes: RemoteTaskAttributes(),
                                   content: content, pushType: nil)
        } catch {
          reject("LIVE_ACTIVITY_UNAVAILABLE", "Live Activity unavailable", nil)
          return
        }
      }
      resolve(nil)
    }
  }

  @objc(clear:reject:)
  func clear(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    Task { @MainActor in
      for activity in Activity<RemoteTaskAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      resolve(nil)
    }
  }
}
