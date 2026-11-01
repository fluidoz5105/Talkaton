#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString * const TalkatonURLString = @"https://talkaton.org/chat?desktop=1";

@interface TalkatonAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@end

@implementation TalkatonAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self installMenu];
    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    configuration.allowsAirPlayForMediaPlayback = YES;
    configuration.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    self.webView.customUserAgent = @"TalkatonDesktop/1.0 (macOS)";
    self.webView.allowsMagnification = YES;

    NSRect frame = NSMakeRect(0, 0, 1440, 920);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    self.window = [[NSWindow alloc] initWithContentRect:frame styleMask:style backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Talkaton";
    self.window.minSize = NSMakeSize(900, 620);
    self.window.contentView = self.webView;
    self.window.delegate = self;
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [self loadTalkaton];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return NO; }

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    if (!flag) [self.window makeKeyAndOrderFront:nil];
    return YES;
}

- (void)loadTalkaton {
    NSURL *url = [NSURL URLWithString:TalkatonURLString];
    NSURLRequest *request = [NSURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadRevalidatingCacheData timeoutInterval:60];
    [self.webView loadRequest:request];
}

- (void)installMenu {
    NSMenu *mainMenu = [[NSMenu alloc] init];
    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:appItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Talkaton"];
    [appMenu addItemWithTitle:@"About Talkaton" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Hide Talkaton" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItemWithTitle:@"Quit Talkaton" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;

    NSMenuItem *editItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;
    NSApp.mainMenu = mainMenu;
}

- (BOOL)isTrustedHost:(NSString *)host {
    return [host hasSuffix:@"talkaton.org"] || [host hasSuffix:@"supabase.co"] || [host hasSuffix:@"google.com"] || [host hasSuffix:@"googleusercontent.com"];
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    if (!url || ![url.scheme isEqualToString:@"https"]) {
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }
    if (navigationAction.navigationType == WKNavigationTypeLinkActivated && ![self isTrustedHost:url.host ?: @""]) {
        [[NSWorkspace sharedWorkspace] openURL:url];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (nullable WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)navigationAction windowFeatures:(WKWindowFeatures *)windowFeatures {
    NSURL *url = navigationAction.request.URL;
    if (url) [[NSWorkspace sharedWorkspace] openURL:url];
    return nil;
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSString *html = @"<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#f7f7f8;font:16px -apple-system;text-align:center}.card{padding:42px;border:1px solid #303036;border-radius:22px;background:#151518}.mark{display:grid;width:48px;height:48px;margin:auto;place-items:center;border-radius:14px;background:#f44449;font-weight:900}h1{margin:24px 0 8px}p{color:#a3a3ab}a{display:block;margin-top:24px;padding:14px;border-radius:12px;background:#fff;color:#09090b;text-decoration:none;font-weight:800}</style><div class='card'><span class='mark'>T</span><h1>Talkaton is offline</h1><p>Check your connection and try again.</p><a href='https://talkaton.org/chat?desktop=1'>Try again</a></div>";
    [webView loadHTMLString:html baseURL:[NSURL URLWithString:TalkatonURLString]];
}

- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision))decisionHandler API_AVAILABLE(macos(12.0)) {
    BOOL allowed = [origin.host isEqualToString:@"talkaton.org"] && type == WKMediaCaptureTypeMicrophone;
    decisionHandler(allowed ? WKPermissionDecisionGrant : WKPermissionDecisionDeny);
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        TalkatonAppDelegate *delegate = [[TalkatonAppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
