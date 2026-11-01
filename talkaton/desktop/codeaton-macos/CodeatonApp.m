#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString * const CodeatonURLString = @"https://talkaton.org/codeaton/app?desktop=1";

@interface CodeatonAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@end

@implementation CodeatonAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self installMenu];
    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    self.webView.customUserAgent = @"CodeatonDesktop/1.0 (macOS)";
    self.webView.allowsMagnification = YES;

    NSRect frame = NSMakeRect(0, 0, 1540, 960);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    self.window = [[NSWindow alloc] initWithContentRect:frame styleMask:style backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Codeaton";
    self.window.minSize = NSMakeSize(980, 650);
    self.window.contentView = self.webView;
    self.window.delegate = self;
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [self loadCodeaton];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return NO; }

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    if (!flag) [self.window makeKeyAndOrderFront:nil];
    return YES;
}

- (void)loadCodeaton {
    NSURL *url = [NSURL URLWithString:CodeatonURLString];
    NSURLRequest *request = [NSURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadRevalidatingCacheData timeoutInterval:60];
    [self.webView loadRequest:request];
}

- (void)installMenu {
    NSMenu *mainMenu = [[NSMenu alloc] init];
    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:appItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Codeaton"];
    [appMenu addItemWithTitle:@"About Codeaton" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Hide Codeaton" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItemWithTitle:@"Quit Codeaton" action:@selector(terminate:) keyEquivalent:@"q"];
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
    NSString *html = @"<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080909;color:#f7f8f7;font:16px -apple-system;text-align:center}.card{padding:42px;border:1px solid #303633;border-radius:22px;background:#141715}.mark{display:grid;width:52px;height:52px;margin:auto;place-items:center;border-radius:14px;background:#7be2a8;color:#07120b;font-weight:900}h1{margin:24px 0 8px}p{color:#a3aba6}a{display:block;margin-top:24px;padding:14px;border-radius:12px;background:#7be2a8;color:#07120b;text-decoration:none;font-weight:800}</style><div class='card'><span class='mark'>C_</span><h1>Codeaton is offline</h1><p>Check your connection and try again.</p><a href='https://talkaton.org/codeaton/app?desktop=1'>Try again</a></div>";
    [webView loadHTMLString:html baseURL:[NSURL URLWithString:CodeatonURLString]];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        CodeatonAppDelegate *delegate = [[CodeatonAppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
