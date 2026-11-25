import ActivityKit
import SwiftUI
import WidgetKit

private typealias Context = ActivityViewContext<RemoteTaskAttributes>

@main
struct RemoteTaskWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RemoteTaskAttributes.self) { context in
      HStack(spacing: 12) {
        badge(context)
        VStack(alignment: .leading, spacing: 3) {
          Text(context.isStale ? context.state.paused : context.state.phase).font(.headline)
          Text("DSH Remote").font(.caption)
          if !context.isStale && !context.state.count.isEmpty {
            Text(context.state.count).font(.caption)
          }
        }
        Spacer()
        timer(context)
      }
      .padding()
      .widgetURL(context.state.conversation)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { badge(context) }
        DynamicIslandExpandedRegion(.trailing) { timer(context) }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 4) {
            Text(context.state.title).font(.headline).lineLimit(1).privacySensitive()
            Text(context.isStale ? context.state.paused : context.state.phase)
            if !context.isStale && !context.state.count.isEmpty {
              Text(context.state.count).font(.caption)
            }
          }.frame(maxWidth: .infinity, alignment: .leading)
        }
      } compactLeading: {
        badge(context)
      } compactTrailing: {
        if !context.isStale && !context.state.waiting && context.state.started != nil {
          timer(context).frame(maxWidth: 56)
        } else {
          Text(context.isStale ? context.state.paused : context.state.phase)
            .font(.caption2).lineLimit(1).minimumScaleFactor(0.65)
        }
      } minimal: {
        badge(context)
      }
      .widgetURL(context.state.conversation)
    }
  }

  @ViewBuilder private func badge(_ context: Context) -> some View {
    if context.isStale {
      Image(systemName: "pause.circle")
    } else if context.state.waiting {
      Image(systemName: "exclamationmark.bubble").accessibilityLabel(Text(context.state.phase))
    } else {
      Text(context.state.badge).font(.headline)
    }
  }

  @ViewBuilder private func timer(_ context: Context) -> some View {
    if !context.isStale && !context.state.waiting, let start = context.state.started {
      Text(start, style: .timer).monospacedDigit().font(.caption)
    }
  }
}
