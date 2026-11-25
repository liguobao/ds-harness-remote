#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DshRemoteLiveTask, NSObject)
RCT_EXTERN_METHOD(update:(NSDictionary *)value resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clear:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
