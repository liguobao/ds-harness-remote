internal import Expo
import UIKit
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  // DSH background connection grace
  private var dshRemoteBackgroundTask: UIBackgroundTaskIdentifier = .invalid
  fileprivate var dshRemoteLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    dshRemoteLaunchOptions = launchOptions

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  public override func applicationDidEnterBackground(_ application: UIApplication) {
    super.applicationDidEnterBackground(application)
    guard dshRemoteBackgroundTask == .invalid else { return }
    dshRemoteBackgroundTask = application.beginBackgroundTask(withName: "DSH Remote connection grace") { [weak self] in
      self?.endDshRemoteBackgroundTask(application)
    }
  }

  public override func applicationWillEnterForeground(_ application: UIApplication) {
    endDshRemoteBackgroundTask(application)
    super.applicationWillEnterForeground(application)
  }

  private func endDshRemoteBackgroundTask(_ application: UIApplication) {
    guard dshRemoteBackgroundTask != .invalid else { return }
    application.endBackgroundTask(dshRemoteBackgroundTask)
    dshRemoteBackgroundTask = .invalid
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

// DSH iOS scene lifecycle
extension AppDelegate {
  fileprivate func startReactNative(in sceneWindow: UIWindow, connectionOptions: UIScene.ConnectionOptions) {
    guard let factory = reactNativeFactory else {
      fatalError("DSH Remote: React Native factory was not initialized")
    }

    var launchOptions = dshRemoteLaunchOptions ?? [:]
    if let context = connectionOptions.urlContexts.first {
      launchOptions[.url] = context.url
      if let sourceApplication = context.options.sourceApplication {
        launchOptions[.sourceApplication] = sourceApplication
      }
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }

    // Keep Expo subscribers' access to the application window working.
    window = sceneWindow
    factory.startReactNative(withModuleName: "main", in: sceneWindow, launchOptions: launchOptions)
    dshRemoteLaunchOptions = nil
  }
}

class DSHRemoteSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene, let appDelegate else { return }
    let sceneWindow = UIWindow(windowScene: windowScene)
    window = sceneWindow
    appDelegate.startReactNative(in: sceneWindow, connectionOptions: connectionOptions)
  }

  // UIKit no longer calls these application delegate methods with scenes.
  // Forward to Expo subscribers and the existing connection grace hooks.
  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
