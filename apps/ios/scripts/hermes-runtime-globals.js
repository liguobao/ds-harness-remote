// Compiler declarations only, consumed by hermesc -include-globals.
// This file is NOT bundled or executed and does not install polyfills.

// React Native InitializeCore: timers, networking, performance and native UI.
var setTimeout, clearTimeout, setInterval, clearInterval;
var setImmediate, clearImmediate, requestAnimationFrame, cancelAnimationFrame;
var XMLHttpRequest, FormData, fetch, Headers, Request, Response, WebSocket;
var Blob, FileReader, URL, URLSearchParams, AbortSignal;
var ErrorUtils, nativeFabricUIManager, performance;

// Hermes native APIs and Expo's winter runtime / Metro stream polyfills.
var Promise, Intl, TextEncoder, TextDecoder, btoa, atob;
var ReadableStream, WritableStream, TransformStream, DOMException;

// index.ts installs this with react-native-webrtc.registerGlobals(). It can be
// unavailable if native loading fails; the transport still checks typeof.
var RTCPeerConnection;

// Buffer (Node-only fallback) and Image (browser-only API) are intentionally
// absent. Keep diagnostics for those and any new, unreviewed global reference.
