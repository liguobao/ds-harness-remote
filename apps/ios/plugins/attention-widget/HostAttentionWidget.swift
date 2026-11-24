import ActivityKit
import SwiftUI
import WidgetKit

@main
struct HostAttentionWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HostAttentionAttributes.self) { context in
      VStack(alignment: .leading, spacing: 8) {
        Text(verbatim: context.attributes.hostName).font(.headline).lineLimit(1)
        counts(context.state)
      }
      .padding()
      .widgetURL(context.attributes.inboxURL(token: context.state.attentionToken))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.center) {
          Text(verbatim: context.attributes.hostName).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) { counts(context.state) }
      } compactLeading: {
        Image(systemName: "tray")
      } compactTrailing: {
        badge(context.state)
      } minimal: {
        badge(context.state)
      }
      .widgetURL(context.attributes.inboxURL(token: context.state.attentionToken))
    }
  }

  private func counts(_ state: HostAttentionAttributes.ContentState) -> some View {
    HStack(spacing: 14) {
      Label(String(state.pendingApprovals), systemImage: "hand.raised")
      Label(String(state.pendingQuestions), systemImage: "questionmark.bubble")
      Label(String(state.runningSessions), systemImage: "play.circle")
      Label(String(state.completedUnread), systemImage: "tray")
    }.monospacedDigit()
  }

  private func badge(_ state: HostAttentionAttributes.ContentState) -> some View {
    let pending = state.pendingApprovals + state.pendingQuestions
    let remaining = state.runningSessions > 0 ? state.runningSessions : state.completedUnread
    return Text(verbatim: String(pending > 0 ? pending : remaining))
      .foregroundStyle(pending > 0 ? Color.orange : Color.primary)
      .monospacedDigit()
  }
}
