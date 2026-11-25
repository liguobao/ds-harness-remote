import ActivityKit
import SwiftUI
import WidgetKit

@main
struct HostAttentionWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HostAttentionAttributes.self) { context in
      VStack(alignment: .leading, spacing: 8) {
        Text(verbatim: context.attributes.hostName).font(.headline).lineLimit(1)
        phaseRow(context)
        counts(context.state)
      }
      .padding()
      .widgetURL(context.attributes.inboxURL(token: context.state.attentionToken))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.center) {
          Text(verbatim: context.attributes.hostName).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack { phaseRow(context); counts(context.state) }
        }
      } compactLeading: {
        if context.isStale { Image(systemName: "pause.circle") } else { badge(context.state) }
      } compactTrailing: {
        if context.isStale { Image(systemName: "pause") }
        else if let start = startDate(context.state) { Text(start, style: .timer).monospacedDigit().frame(maxWidth: 56) }
        else if let phase = context.state.phase { Text(verbatim: phase).font(.caption).lineLimit(1) }
        else { Image(systemName: "tray") }
      } minimal: {
        badge(context.state)
      }
      .widgetURL(context.attributes.inboxURL(token: context.state.attentionToken))
    }
  }

  private func startDate(_ state: HostAttentionAttributes.ContentState) -> Date? {
    guard state.pendingApprovals + state.pendingQuestions == 0, state.runningSessions > 0,
          let ms = state.startedAtMs, ms > 0 else { return nil }
    let date = Date(timeIntervalSince1970: ms / 1000)
    return date <= Date() ? date : nil
  }

  @ViewBuilder private func phaseRow(_ context: ActivityViewContext<HostAttentionAttributes>) -> some View {
    if context.isStale, let paused = context.state.paused {
      Text(verbatim: paused).font(.caption)
    } else if let phase = context.state.phase {
      HStack {
        Text(verbatim: phase)
        if let start = startDate(context.state) { Text(start, style: .timer).monospacedDigit() }
      }.font(.subheadline)
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
