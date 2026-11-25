import ActivityKit
import Foundation

struct RemoteTaskAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let title: String
    let phase: String
    let badge: String
    let waiting: Bool
    let started: Date?
    let count: String
    let paused: String
    let host: String
    let session: String

    var conversation: URL? {
      var components = URLComponents()
      components.scheme = "dshremote"
      components.host = "conversation"
      components.queryItems = [URLQueryItem(name: "host", value: host), URLQueryItem(name: "session", value: session)]
      // URLSearchParams in the JS router decodes a literal plus as a space.
      components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
      return components.url
    }
  }
}
