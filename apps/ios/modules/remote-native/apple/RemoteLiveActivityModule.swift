import ActivityKit
import ExpoModulesCore

private struct AttentionUpdate: Record {
  @Field var hostId = ""
  @Field var hostName = ""
  @Field var pendingApprovals = 0
  @Field var pendingQuestions = 0
  @Field var runningSessions = 0
  @Field var completedUnread = 0
  @Field var attentionToken: String?
}

public final class RemoteLiveActivityModule: Module {
  private typealias HostActivity = Activity<HostAttentionAttributes>

  public func definition() -> ModuleDefinition {
    Name("DshRemoteLiveActivity")

    AsyncFunction("update") { (input: AttentionUpdate, alert: String?) async throws in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
      let attributes = HostAttentionAttributes(hostId: input.hostId, hostName: input.hostName)
      let state = HostAttentionAttributes.ContentState(
        pendingApprovals: input.pendingApprovals, pendingQuestions: input.pendingQuestions,
        runningSessions: input.runningSessions, completedUnread: input.completedUnread,
        attentionToken: input.attentionToken)
      let content = ActivityContent(state: state, staleDate: nil)
      var current: HostActivity?
      for activity in HostActivity.activities {
        if activity.attributes.hostId == attributes.hostId,
           activity.attributes.hostName == attributes.hostName, current == nil {
          current = activity
        } else {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      let activity = try current ?? HostActivity.request(attributes: attributes, content: content, pushType: nil)
      if let alert {
        let notification = AlertConfiguration(title: "\(input.hostName)", body: "\(alert)", sound: .default)
        await activity.update(content, alertConfiguration: notification)
      } else if current != nil {
        await activity.update(content)
      }
    }

    AsyncFunction("end") { (hostId: String?) async in
      for activity in HostActivity.activities where hostId == nil || activity.attributes.hostId == hostId {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
