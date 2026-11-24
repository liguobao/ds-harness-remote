import ActivityKit
import Foundation

struct HostAttentionAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var pendingApprovals: Int
    var pendingQuestions: Int
    var runningSessions: Int
    var completedUnread: Int
    var attentionToken: String?
  }

  let hostId: String
  let hostName: String

  func inboxURL(token: String?) -> URL? {
    var url = URLComponents()
    url.scheme = "dshremote"
    url.host = "attention"
    url.queryItems = [URLQueryItem(name: "host", value: hostId)]
    if let token { url.queryItems?.append(URLQueryItem(name: "token", value: token)) }
    return url.url
  }
}
