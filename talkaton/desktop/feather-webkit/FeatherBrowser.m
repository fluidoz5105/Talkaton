#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString * const FeatherProductName = @"Feather Browser";
static NSString * const FeatherHomeURL = @"https://www.google.com/";
static NSInteger const FeatherMaximumTabs = 12;

@class FeatherBrowserDelegate;

@interface FeatherTab : NSObject
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSButton *tabButton;
@property(nonatomic, strong) NSButton *closeButton;
@property(nonatomic, strong) NSStackView *tabControl;
@property(nonatomic, copy) NSString *displayTitle;
@property(nonatomic, strong) NSURL *failedURL;
@property(nonatomic) BOOL observing;
@property(nonatomic) BOOL loadingErrorPage;
@end

@implementation FeatherTab
@end

@interface FeatherBrowserDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, NSTextFieldDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSView *rootView;
@property(nonatomic, strong) NSStackView *tabStack;
@property(nonatomic, strong) NSView *pageContainer;
@property(nonatomic, strong) NSTextField *addressField;
@property(nonatomic, strong) NSButton *backButton;
@property(nonatomic, strong) NSButton *forwardButton;
@property(nonatomic, strong) NSButton *reloadButton;
@property(nonatomic, strong) NSButton *downloadsButton;
@property(nonatomic, strong) NSProgressIndicator *progressIndicator;
@property(nonatomic, strong) NSMutableArray<FeatherTab *> *tabs;
@property(nonatomic, strong) NSMutableArray<NSURL *> *closedURLs;
@property(nonatomic, weak) FeatherTab *activeTab;
@property(nonatomic, strong) NSMenu *downloadsMenu;
@property(nonatomic, strong) NSMutableDictionary<NSValue *, NSURL *> *downloadDestinations;
@property(nonatomic, strong) NSMutableSet<NSValue *> *observedDownloads;
@property(nonatomic) NSInteger newTabSequence;
@property(nonatomic) BOOL smokeTest;
@property(nonatomic, strong) NSURL *smokeDownloadURL;
@property(nonatomic, strong) NSURL *smokeOfflineURL;
@end

@implementation FeatherBrowserDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.tabs = [NSMutableArray array];
    self.closedURLs = [NSMutableArray array];
    self.downloadDestinations = [NSMutableDictionary dictionary];
    self.observedDownloads = [NSMutableSet set];
    self.downloadsMenu = [[NSMenu alloc] initWithTitle:@"Downloads"];
    NSArray<NSString *> *arguments = [[NSProcessInfo processInfo] arguments];
    self.smokeTest = [arguments containsObject:@"--smoke-test"];
    for (NSString *argument in arguments) {
        if ([argument hasPrefix:@"--download-smoke-url="]) self.smokeDownloadURL = [NSURL URLWithString:[argument substringFromIndex:@"--download-smoke-url=".length]];
        if ([argument hasPrefix:@"--offline-smoke-url="]) self.smokeOfflineURL = [NSURL URLWithString:[argument substringFromIndex:@"--offline-smoke-url=".length]];
    }
    self.smokeTest = self.smokeTest || self.smokeDownloadURL != nil || self.smokeOfflineURL != nil;
    [self installMenu];
    [self createWindow];
    [self createTabWithURL:nil activate:YES];

    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];

    if (self.smokeDownloadURL) [self loadURL:self.smokeDownloadURL inTab:self.activeTab];
    else if (self.smokeOfflineURL) [self loadURL:self.smokeOfflineURL inTab:self.activeTab];
    else if (self.smokeTest) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.6 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            BOOL passed = self.tabs.count == 1 && self.activeTab != nil && self.activeTab.webView != nil;
            fprintf(stdout, "FEATHER_WEBKIT_SMOKE_%s\n", passed ? "OK" : "FAILED");
            fflush(stdout);
            [NSApp terminate:nil];
        });
    }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    if (!flag) [self.window makeKeyAndOrderFront:nil];
    return YES;
}

- (void)createWindow {
    NSRect frame = NSMakeRect(0, 0, 1280, 820);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView;
    self.window = [[NSWindow alloc] initWithContentRect:frame styleMask:style backing:NSBackingStoreBuffered defer:NO];
    self.window.title = FeatherProductName;
    self.window.minSize = NSMakeSize(720, 520);
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.titlebarAppearsTransparent = YES;
    self.window.movableByWindowBackground = YES;
    self.window.delegate = self;
    self.window.backgroundColor = [NSColor colorWithWhite:0.965 alpha:1];

    self.rootView = [[NSView alloc] initWithFrame:frame];
    self.rootView.wantsLayer = YES;
    self.rootView.layer.backgroundColor = [NSColor colorWithWhite:0.975 alpha:1].CGColor;
    self.window.contentView = self.rootView;

    [self buildTabBar];
    [self buildToolbar];

    self.pageContainer = [[NSView alloc] initWithFrame:NSZeroRect];
    self.pageContainer.translatesAutoresizingMaskIntoConstraints = NO;
    self.pageContainer.wantsLayer = YES;
    self.pageContainer.layer.backgroundColor = NSColor.whiteColor.CGColor;
    [self.rootView addSubview:self.pageContainer];

    [NSLayoutConstraint activateConstraints:@[
        [self.pageContainer.leadingAnchor constraintEqualToAnchor:self.rootView.leadingAnchor],
        [self.pageContainer.trailingAnchor constraintEqualToAnchor:self.rootView.trailingAnchor],
        [self.pageContainer.bottomAnchor constraintEqualToAnchor:self.rootView.bottomAnchor],
        [self.pageContainer.topAnchor constraintEqualToAnchor:self.progressIndicator.superview.bottomAnchor]
    ]];
}

- (NSButton *)toolbarButtonWithSymbol:(NSString *)symbol fallback:(NSString *)fallback action:(SEL)action tooltip:(NSString *)tooltip {
    NSButton *button = [NSButton buttonWithTitle:fallback target:self action:action];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    button.bordered = NO;
    button.bezelStyle = NSBezelStyleTexturedRounded;
    button.toolTip = tooltip;
    button.font = [NSFont systemFontOfSize:15 weight:NSFontWeightMedium];
    if (@available(macOS 11.0, *)) {
        NSImage *image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:tooltip];
        if (image) { button.image = image; button.title = @""; }
    }
    [NSLayoutConstraint activateConstraints:@[
        [button.widthAnchor constraintEqualToConstant:34],
        [button.heightAnchor constraintEqualToConstant:34]
    ]];
    return button;
}

- (void)buildTabBar {
    NSVisualEffectView *tabBar = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
    tabBar.translatesAutoresizingMaskIntoConstraints = NO;
    tabBar.material = NSVisualEffectMaterialTitlebar;
    tabBar.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    tabBar.state = NSVisualEffectStateActive;
    [self.rootView addSubview:tabBar];

    self.tabStack = [[NSStackView alloc] initWithFrame:NSZeroRect];
    self.tabStack.translatesAutoresizingMaskIntoConstraints = NO;
    self.tabStack.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    self.tabStack.alignment = NSLayoutAttributeCenterY;
    self.tabStack.spacing = 4;
    self.tabStack.distribution = NSStackViewDistributionFill;
    [tabBar addSubview:self.tabStack];

    NSButton *newTab = [self toolbarButtonWithSymbol:@"plus" fallback:@"+" action:@selector(newTab:) tooltip:@"New Tab (⌘T)"];
    [tabBar addSubview:newTab];

    [NSLayoutConstraint activateConstraints:@[
        [tabBar.topAnchor constraintEqualToAnchor:self.rootView.topAnchor],
        [tabBar.leadingAnchor constraintEqualToAnchor:self.rootView.leadingAnchor],
        [tabBar.trailingAnchor constraintEqualToAnchor:self.rootView.trailingAnchor],
        [tabBar.heightAnchor constraintEqualToConstant:43],
        [self.tabStack.leadingAnchor constraintEqualToAnchor:tabBar.leadingAnchor constant:80],
        [self.tabStack.centerYAnchor constraintEqualToAnchor:tabBar.centerYAnchor constant:4],
        [newTab.leadingAnchor constraintEqualToAnchor:self.tabStack.trailingAnchor constant:5],
        [newTab.trailingAnchor constraintLessThanOrEqualToAnchor:tabBar.trailingAnchor constant:-12],
        [newTab.centerYAnchor constraintEqualToAnchor:self.tabStack.centerYAnchor]
    ]];
}

- (void)buildToolbar {
    NSVisualEffectView *toolbar = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
    toolbar.translatesAutoresizingMaskIntoConstraints = NO;
    toolbar.material = NSVisualEffectMaterialHeaderView;
    toolbar.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    toolbar.state = NSVisualEffectStateActive;
    [self.rootView addSubview:toolbar];

    self.backButton = [self toolbarButtonWithSymbol:@"chevron.left" fallback:@"‹" action:@selector(goBack:) tooltip:@"Back"];
    self.forwardButton = [self toolbarButtonWithSymbol:@"chevron.right" fallback:@"›" action:@selector(goForward:) tooltip:@"Forward"];
    self.reloadButton = [self toolbarButtonWithSymbol:@"arrow.clockwise" fallback:@"↻" action:@selector(reloadOrStop:) tooltip:@"Reload"];
    self.downloadsButton = [self toolbarButtonWithSymbol:@"arrow.down.circle" fallback:@"↓" action:@selector(showDownloads:) tooltip:@"Downloads"];

    self.addressField = [[NSTextField alloc] initWithFrame:NSZeroRect];
    self.addressField.translatesAutoresizingMaskIntoConstraints = NO;
    self.addressField.delegate = self;
    self.addressField.placeholderString = @"Search Google or enter an address";
    self.addressField.font = [NSFont systemFontOfSize:14];
    self.addressField.focusRingType = NSFocusRingTypeExterior;
    self.addressField.bezelStyle = NSTextFieldRoundedBezel;
    self.addressField.cell.scrollable = YES;
    self.addressField.cell.lineBreakMode = NSLineBreakByTruncatingTail;
    [self.addressField.heightAnchor constraintEqualToConstant:34].active = YES;

    self.progressIndicator = [[NSProgressIndicator alloc] initWithFrame:NSZeroRect];
    self.progressIndicator.translatesAutoresizingMaskIntoConstraints = NO;
    self.progressIndicator.style = NSProgressIndicatorStyleBar;
    self.progressIndicator.indeterminate = NO;
    self.progressIndicator.minValue = 0;
    self.progressIndicator.maxValue = 1;
    self.progressIndicator.hidden = YES;

    NSArray<NSView *> *views = @[self.backButton, self.forwardButton, self.reloadButton, self.addressField, self.downloadsButton];
    NSStackView *stack = [NSStackView stackViewWithViews:views];
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    stack.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    stack.alignment = NSLayoutAttributeCenterY;
    stack.spacing = 5;
    [toolbar addSubview:stack];
    [toolbar addSubview:self.progressIndicator];

    [NSLayoutConstraint activateConstraints:@[
        [toolbar.topAnchor constraintEqualToAnchor:self.rootView.topAnchor constant:43],
        [toolbar.leadingAnchor constraintEqualToAnchor:self.rootView.leadingAnchor],
        [toolbar.trailingAnchor constraintEqualToAnchor:self.rootView.trailingAnchor],
        [toolbar.heightAnchor constraintEqualToConstant:58],
        [stack.leadingAnchor constraintEqualToAnchor:toolbar.leadingAnchor constant:11],
        [stack.trailingAnchor constraintEqualToAnchor:toolbar.trailingAnchor constant:-11],
        [stack.centerYAnchor constraintEqualToAnchor:toolbar.centerYAnchor],
        [self.addressField.widthAnchor constraintGreaterThanOrEqualToConstant:240],
        [self.progressIndicator.leadingAnchor constraintEqualToAnchor:toolbar.leadingAnchor],
        [self.progressIndicator.trailingAnchor constraintEqualToAnchor:toolbar.trailingAnchor],
        [self.progressIndicator.bottomAnchor constraintEqualToAnchor:toolbar.bottomAnchor],
        [self.progressIndicator.heightAnchor constraintEqualToConstant:2]
    ]];
}

- (WKWebViewConfiguration *)webConfiguration {
    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = NO;
    configuration.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeAll;
    return configuration;
}

- (FeatherTab *)createTabWithURL:(NSURL *)url activate:(BOOL)activate {
    if (self.tabs.count >= FeatherMaximumTabs) {
        NSBeep();
        return nil;
    }

    FeatherTab *tab = [[FeatherTab alloc] init];
    tab.displayTitle = @"New Tab";
    tab.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:[self webConfiguration]];
    tab.webView.translatesAutoresizingMaskIntoConstraints = NO;
    tab.webView.navigationDelegate = self;
    tab.webView.UIDelegate = self;
    tab.webView.allowsBackForwardNavigationGestures = YES;
    tab.webView.allowsMagnification = YES;
    tab.webView.hidden = YES;
    [self.pageContainer addSubview:tab.webView];
    [NSLayoutConstraint activateConstraints:@[
        [tab.webView.leadingAnchor constraintEqualToAnchor:self.pageContainer.leadingAnchor],
        [tab.webView.trailingAnchor constraintEqualToAnchor:self.pageContainer.trailingAnchor],
        [tab.webView.topAnchor constraintEqualToAnchor:self.pageContainer.topAnchor],
        [tab.webView.bottomAnchor constraintEqualToAnchor:self.pageContainer.bottomAnchor]
    ]];

    tab.tabButton = [NSButton buttonWithTitle:@"New Tab" target:self action:@selector(selectTab:)];
    tab.tabButton.translatesAutoresizingMaskIntoConstraints = NO;
    tab.tabButton.bordered = NO;
    tab.tabButton.bezelStyle = NSBezelStyleShadowlessSquare;
    tab.tabButton.alignment = NSTextAlignmentLeft;
    tab.tabButton.font = [NSFont systemFontOfSize:12.5 weight:NSFontWeightMedium];
    tab.tabButton.contentTintColor = NSColor.labelColor;
    tab.tabButton.cell.lineBreakMode = NSLineBreakByTruncatingTail;
    tab.tabButton.tag = ++self.newTabSequence;
    tab.tabButton.toolTip = @"New Tab";
    [tab.tabButton.widthAnchor constraintGreaterThanOrEqualToConstant:28].active = YES;

    tab.closeButton = [NSButton buttonWithTitle:@"×" target:self action:@selector(closeTabButton:)];
    tab.closeButton.translatesAutoresizingMaskIntoConstraints = NO;
    tab.closeButton.bordered = NO;
    tab.closeButton.tag = tab.tabButton.tag;
    tab.closeButton.toolTip = @"Close Tab";
    tab.closeButton.font = [NSFont systemFontOfSize:14 weight:NSFontWeightRegular];
    if (@available(macOS 11.0, *)) {
        NSImage *closeImage = [NSImage imageWithSystemSymbolName:@"xmark" accessibilityDescription:@"Close Tab"];
        NSImageSymbolConfiguration *configuration = [NSImageSymbolConfiguration configurationWithPointSize:10 weight:NSFontWeightMedium];
        tab.closeButton.image = [closeImage imageWithSymbolConfiguration:configuration];
        tab.closeButton.title = @"";
    }
    [tab.closeButton.widthAnchor constraintEqualToConstant:22].active = YES;
    [tab.closeButton.heightAnchor constraintEqualToConstant:22].active = YES;

    tab.tabControl = [NSStackView stackViewWithViews:@[tab.tabButton, tab.closeButton]];
    tab.tabControl.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    tab.tabControl.alignment = NSLayoutAttributeCenterY;
    tab.tabControl.spacing = 1;
    tab.tabControl.edgeInsets = NSEdgeInsetsMake(0, 10, 0, 5);
    tab.tabControl.identifier = [NSString stringWithFormat:@"tab-%ld", (long)tab.tabButton.tag];
    tab.tabControl.wantsLayer = YES;
    tab.tabControl.layer.cornerRadius = 9;
    tab.tabControl.layer.masksToBounds = YES;
    [tab.tabControl.heightAnchor constraintEqualToConstant:32].active = YES;
    NSLayoutConstraint *preferredTabWidth = [tab.tabControl.widthAnchor constraintEqualToConstant:184];
    preferredTabWidth.priority = 600;
    preferredTabWidth.active = YES;
    [tab.tabControl.widthAnchor constraintGreaterThanOrEqualToConstant:54].active = YES;
    [tab.tabControl.widthAnchor constraintLessThanOrEqualToConstant:184].active = YES;
    [self.tabStack addArrangedSubview:tab.tabControl];
    [self.tabs addObject:tab];
    [self observeTab:tab];
    [self updateTabAppearance];

    if (activate) [self activateTab:tab];
    if (url) [self loadURL:url inTab:tab];
    else [self loadNewTabInTab:tab];
    return tab;
}

- (void)observeTab:(FeatherTab *)tab {
    if (tab.observing) return;
    tab.observing = YES;
    for (NSString *key in @[@"title", @"URL", @"loading", @"estimatedProgress", @"canGoBack", @"canGoForward"]) {
        [tab.webView addObserver:self forKeyPath:key options:NSKeyValueObservingOptionNew context:(__bridge void *)tab];
    }
}

- (void)stopObservingTab:(FeatherTab *)tab {
    if (!tab.observing) return;
    tab.observing = NO;
    for (NSString *key in @[@"title", @"URL", @"loading", @"estimatedProgress", @"canGoBack", @"canGoForward"]) {
        [tab.webView removeObserver:self forKeyPath:key context:(__bridge void *)tab];
    }
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary<NSKeyValueChangeKey,id> *)change context:(void *)context {
    if ([object isKindOfClass:[NSProgress class]]) {
        NSProgress *progress = object;
        self.downloadsButton.contentTintColor = [NSColor systemOrangeColor];
        self.downloadsButton.toolTip = [NSString stringWithFormat:@"Downloading — %.0f%%", progress.fractionCompleted * 100];
        return;
    }
    FeatherTab *tab = (__bridge FeatherTab *)context;
    if (![self.tabs containsObject:tab]) return;
    if ([keyPath isEqualToString:@"title"]) {
        NSString *title = tab.webView.title.length ? tab.webView.title : @"New Tab";
        tab.displayTitle = title;
        tab.tabButton.title = title.length > 24 ? [[title substringToIndex:23] stringByAppendingString:@"…"] : title;
        tab.tabButton.toolTip = title;
    }
    if (tab == self.activeTab) [self updateToolbar];
}

- (void)activateTab:(FeatherTab *)tab {
    if (!tab || ![self.tabs containsObject:tab]) return;
    self.activeTab.webView.hidden = YES;
    self.activeTab.tabButton.state = NSControlStateValueOff;
    self.activeTab = tab;
    tab.webView.hidden = NO;
    tab.tabButton.state = NSControlStateValueOn;
    [self updateTabAppearance];
    [self updateToolbar];
    [self.window makeFirstResponder:tab.webView];
}

- (void)updateTabAppearance {
    for (FeatherTab *tab in self.tabs) {
        BOOL active = tab == self.activeTab;
        tab.tabControl.layer.backgroundColor = active
            ? [NSColor colorWithWhite:1 alpha:0.92].CGColor
            : NSColor.clearColor.CGColor;
        tab.tabControl.layer.borderWidth = active ? 0.5 : 0;
        tab.tabControl.layer.borderColor = [NSColor colorWithWhite:0 alpha:0.13].CGColor;
        tab.tabButton.contentTintColor = active ? NSColor.labelColor : NSColor.secondaryLabelColor;
        tab.closeButton.contentTintColor = active ? NSColor.secondaryLabelColor : NSColor.tertiaryLabelColor;
        tab.closeButton.alphaValue = active ? 1 : 0.72;
    }
}

- (FeatherTab *)tabForTag:(NSInteger)tag {
    for (FeatherTab *tab in self.tabs) if (tab.tabButton.tag == tag) return tab;
    return nil;
}

- (FeatherTab *)tabForWebView:(WKWebView *)webView {
    for (FeatherTab *tab in self.tabs) if (tab.webView == webView) return tab;
    return nil;
}

- (void)selectTab:(NSButton *)sender { [self activateTab:[self tabForTag:sender.tag]]; }
- (void)closeTabButton:(NSButton *)sender { [self closeTab:[self tabForTag:sender.tag]]; }

- (void)closeTab:(FeatherTab *)tab {
    if (!tab) return;
    NSUInteger index = [self.tabs indexOfObjectIdenticalTo:tab];
    if (index == NSNotFound) return;
    NSURL *url = tab.failedURL ?: tab.webView.URL;
    if ([self isWebURL:url]) {
        [self.closedURLs insertObject:url atIndex:0];
        if (self.closedURLs.count > 10) [self.closedURLs removeLastObject];
    }
    BOOL wasActive = (tab == self.activeTab);
    [self stopObservingTab:tab];
    [tab.webView stopLoading];
    [tab.webView removeFromSuperview];
    [tab.tabButton.superview removeFromSuperview];
    [self.tabs removeObjectAtIndex:index];
    [self updateTabAppearance];
    if (wasActive) self.activeTab = nil;
    if (self.tabs.count == 0) [self createTabWithURL:nil activate:YES];
    else if (wasActive) [self activateTab:self.tabs[MIN(index, self.tabs.count - 1)]];
}

- (BOOL)isWebURL:(NSURL *)url {
    NSString *scheme = url.scheme.lowercaseString;
    return [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"];
}

- (NSURL *)URLFromInput:(NSString *)raw {
    NSString *value = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (value.length == 0) return nil;
    NSURLComponents *components = [NSURLComponents componentsWithString:value];
    NSString *scheme = components.scheme.lowercaseString;
    if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) return components.URL;
    if (scheme.length > 0 && ![value hasPrefix:@"localhost:"]) return nil;

    BOOL local = [value hasPrefix:@"localhost"] || [value hasPrefix:@"127.0.0.1"];
    BOOL domainLike = local || ([value rangeOfString:@" "].location == NSNotFound && [value rangeOfString:@"."].location != NSNotFound);
    if (domainLike) return [NSURL URLWithString:[NSString stringWithFormat:@"%@://%@", local ? @"http" : @"https", value]];

    NSURLComponents *search = [NSURLComponents componentsWithString:@"https://www.google.com/search"];
    search.queryItems = @[[NSURLQueryItem queryItemWithName:@"q" value:value]];
    return search.URL;
}

- (void)loadURL:(NSURL *)url inTab:(FeatherTab *)tab {
    if (![self isWebURL:url]) return;
    tab.failedURL = nil;
    NSURLRequest *request = [NSURLRequest requestWithURL:url cachePolicy:NSURLRequestUseProtocolCachePolicy timeoutInterval:60];
    [tab.webView loadRequest:request];
}

- (void)loadNewTabInTab:(FeatherTab *)tab {
    tab.failedURL = nil;
    tab.displayTitle = @"New Tab";
    NSString *html = @"<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>New Tab</title><style>*{box-sizing:border-box}body{display:grid;min-height:100vh;margin:0;place-items:center;background:#fbfcfb;color:#17201d;font-family:-apple-system,BlinkMacSystemFont,sans-serif}.box{width:min(620px,calc(100vw - 48px));margin-top:-10vh;text-align:center}.mark{display:inline-grid;width:58px;height:58px;place-items:center;border-radius:18px;background:#daf0e6;color:#177b59;font-size:31px}h1{margin:18px 0 7px;font-size:30px}p{margin:0 0 28px;color:#71807a}form{display:flex;height:52px;border:1px solid #dce2df;border-radius:16px;background:white;box-shadow:0 12px 38px #1c302717}input{flex:1;padding:0 18px;border:0;outline:0;background:transparent;font:15px -apple-system}button{margin:7px;padding:0 18px;border:0;border-radius:11px;background:#177b59;color:white;font-weight:600}</style><div class='box'><div class='mark'>⌁</div><h1>Browse lightly.</h1><p>Native WebKit, without a bundled browser engine.</p><form action='https://www.google.com/search'><input name='q' autofocus placeholder='Search Google'><button>Search</button></form></div>";
    [tab.webView loadHTMLString:html baseURL:[NSURL URLWithString:FeatherHomeURL]];
}

- (void)showOfflineForTab:(FeatherTab *)tab URL:(NSURL *)url error:(NSError *)error {
    if (!tab || ![self isWebURL:url]) return;
    tab.failedURL = url;
    tab.loadingErrorPage = YES;
    NSString *escapedURL = [url.absoluteString stringByReplacingOccurrencesOfString:@"'" withString:@"%27"];
    NSString *html = [NSString stringWithFormat:@"<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Site unavailable</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#fbfcfb;color:#17201d;font-family:-apple-system}.card{width:min(560px,calc(100vw - 48px));margin-top:-7vh}h1{font-size:29px}p{color:#68736e;line-height:1.55}.url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px ui-monospace}.actions{display:flex;gap:10px;margin-top:28px}a{padding:11px 16px;border:1px solid #d8dfdc;border-radius:11px;color:#34413b;text-decoration:none;font-weight:600}.primary{background:#177b59;color:white;border-color:#177b59}</style><div class='card'><h1>This site isn’t available</h1><p>Feather couldn’t reach the server. Check your connection, then try again.</p><div class='url'>%@</div><div class='actions'><a class='primary' href='%@'>Try again</a><a href='https://www.google.com/search?q=%@'>Search Google</a></div><p>Feather retries connection failures but does not bypass network security or administrator blocks.</p></div>", escapedURL, escapedURL, [url.host stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLQueryAllowedCharacterSet] ?: @""];
    [tab.webView loadHTMLString:html baseURL:[NSURL URLWithString:FeatherHomeURL]];
    [self updateToolbar];
}

- (void)updateToolbar {
    FeatherTab *tab = self.activeTab;
    if (!tab) return;
    self.backButton.enabled = tab.webView.canGoBack;
    self.forwardButton.enabled = tab.webView.canGoForward;
    self.addressField.stringValue = tab.failedURL.absoluteString ?: ([self isWebURL:tab.webView.URL] ? tab.webView.URL.absoluteString : @"");
    self.reloadButton.toolTip = tab.webView.loading ? @"Stop" : (tab.failedURL ? @"Try Again" : @"Reload");
    if (@available(macOS 11.0, *)) {
        NSString *symbol = tab.webView.loading ? @"xmark" : @"arrow.clockwise";
        self.reloadButton.image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:self.reloadButton.toolTip];
    }
    self.progressIndicator.hidden = !tab.webView.loading;
    self.progressIndicator.doubleValue = tab.webView.estimatedProgress;
    self.window.title = tab.displayTitle.length ? [NSString stringWithFormat:@"%@ — %@", tab.displayTitle, FeatherProductName] : FeatherProductName;
}

- (void)newTab:(id)sender { [self createTabWithURL:nil activate:YES]; }
- (void)goBack:(id)sender { if (self.activeTab.webView.canGoBack) [self.activeTab.webView goBack]; }
- (void)goForward:(id)sender { if (self.activeTab.webView.canGoForward) [self.activeTab.webView goForward]; }
- (void)goHome:(id)sender { [self loadURL:[NSURL URLWithString:FeatherHomeURL] inTab:self.activeTab]; }

- (void)reloadOrStop:(id)sender {
    if (self.activeTab.webView.loading) [self.activeTab.webView stopLoading];
    else if (self.activeTab.failedURL) [self loadURL:self.activeTab.failedURL inTab:self.activeTab];
    else [self.activeTab.webView reload];
}

- (void)focusAddress:(id)sender {
    [self.window makeFirstResponder:self.addressField];
    [self.addressField selectText:nil];
}

- (void)closeActiveTab:(id)sender { [self closeTab:self.activeTab]; }

- (void)reopenClosedTab:(id)sender {
    NSURL *url = self.closedURLs.firstObject;
    if (!url) return;
    [self.closedURLs removeObjectAtIndex:0];
    [self createTabWithURL:url activate:YES];
}

- (void)controlTextDidEndEditing:(NSNotification *)notification {
    if (notification.object != self.addressField) return;
    NSNumber *movement = notification.userInfo[@"NSTextMovement"];
    if (movement.integerValue != NSReturnTextMovement) return;
    NSURL *url = [self URLFromInput:self.addressField.stringValue];
    if (url) [self loadURL:url inTab:self.activeTab];
    [self.window makeFirstResponder:self.activeTab.webView];
}

- (void)showDownloads:(id)sender {
    if (self.downloadsMenu.numberOfItems == 0) {
        NSMenuItem *empty = [[NSMenuItem alloc] initWithTitle:@"No downloads yet" action:nil keyEquivalent:@""];
        empty.enabled = NO;
        [self.downloadsMenu addItem:empty];
    }
    [self.downloadsMenu popUpMenuPositioningItem:nil atLocation:NSMakePoint(0, self.downloadsButton.bounds.size.height + 3) inView:self.downloadsButton];
}

- (void)openDownloadedFile:(NSMenuItem *)item {
    NSURL *url = item.representedObject;
    if (url) [[NSWorkspace sharedWorkspace] openURL:url];
}

- (void)installMenu {
    NSMenu *mainMenu = [[NSMenu alloc] init];
    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:appItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:FeatherProductName];
    [appMenu addItemWithTitle:@"About Feather Browser" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Hide Feather Browser" action:@selector(hide:) keyEquivalent:@"h"];
    [appMenu addItemWithTitle:@"Quit Feather Browser" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;

    NSMenuItem *fileItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:fileItem];
    NSMenu *fileMenu = [[NSMenu alloc] initWithTitle:@"File"];
    NSMenuItem *newTab = [fileMenu addItemWithTitle:@"New Tab" action:@selector(newTab:) keyEquivalent:@"t"];
    newTab.target = self;
    NSMenuItem *reopen = [fileMenu addItemWithTitle:@"Reopen Closed Tab" action:@selector(reopenClosedTab:) keyEquivalent:@"T"];
    reopen.target = self;
    [fileMenu addItem:[NSMenuItem separatorItem]];
    NSMenuItem *closeTab = [fileMenu addItemWithTitle:@"Close Tab" action:@selector(closeActiveTab:) keyEquivalent:@"w"];
    closeTab.target = self;
    fileItem.submenu = fileMenu;

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

    NSMenuItem *viewItem = [[NSMenuItem alloc] init];
    [mainMenu addItem:viewItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
    NSMenuItem *address = [viewMenu addItemWithTitle:@"Focus Address Bar" action:@selector(focusAddress:) keyEquivalent:@"l"];
    address.target = self;
    NSMenuItem *reload = [viewMenu addItemWithTitle:@"Reload" action:@selector(reloadOrStop:) keyEquivalent:@"r"];
    reload.target = self;
    [viewMenu addItem:[NSMenuItem separatorItem]];
    [viewMenu addItemWithTitle:@"Enter Full Screen" action:@selector(toggleFullScreen:) keyEquivalent:@"f"].keyEquivalentModifierMask = NSEventModifierFlagControl | NSEventModifierFlagCommand;
    viewItem.submenu = viewMenu;
    NSApp.mainMenu = mainMenu;
}

#pragma mark - Navigation

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = action.request.URL;
    if (!url) { decisionHandler(WKNavigationActionPolicyCancel); return; }
    if ([self isWebURL:url]) {
        if (action.shouldPerformDownload) decisionHandler(WKNavigationActionPolicyDownload);
        else decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    if ([url.scheme.lowercaseString isEqualToString:@"about"] || [url.scheme.lowercaseString isEqualToString:@"file"]) { decisionHandler(WKNavigationActionPolicyAllow); return; }
    if ([url.scheme.lowercaseString isEqualToString:@"mailto"] || [url.scheme.lowercaseString isEqualToString:@"tel"]) [[NSWorkspace sharedWorkspace] openURL:url];
    decisionHandler(WKNavigationActionPolicyCancel);
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler API_AVAILABLE(macos(11.3)) {
    if (response.canShowMIMEType) decisionHandler(WKNavigationResponsePolicyAllow);
    else decisionHandler(WKNavigationResponsePolicyDownload);
}

- (nullable WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)navigationAction windowFeatures:(WKWindowFeatures *)windowFeatures {
    FeatherTab *tab = [self createTabWithURL:nil activate:YES];
    return tab.webView;
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
    FeatherTab *tab = [self tabForWebView:webView];
    if (tab.loadingErrorPage) tab.loadingErrorPage = NO;
    else tab.failedURL = nil;
    if (tab == self.activeTab) [self updateToolbar];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation { if ([self tabForWebView:webView] == self.activeTab) [self updateToolbar]; }

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    if (error.code == NSURLErrorCancelled) return;
    NSURL *url = error.userInfo[NSURLErrorFailingURLErrorKey] ?: webView.URL;
    [self showOfflineForTab:[self tabForWebView:webView] URL:url error:error];
    if (self.smokeOfflineURL) {
        fprintf(stdout, "FEATHER_WEBKIT_OFFLINE_OK\n");
        fflush(stdout);
        [NSApp terminate:nil];
    }
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView { [webView reload]; }

- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision))decisionHandler API_AVAILABLE(macos(12.0)) {
    decisionHandler(WKPermissionDecisionDeny);
}

#pragma mark - Downloads

- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)navigationResponse didBecomeDownload:(WKDownload *)download API_AVAILABLE(macos(11.3)) { [self beginDownload:download]; }
- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)navigationAction didBecomeDownload:(WKDownload *)download API_AVAILABLE(macos(11.3)) { [self beginDownload:download]; }

- (void)beginDownload:(WKDownload *)download API_AVAILABLE(macos(11.3)) {
    download.delegate = self;
    NSValue *key = [NSValue valueWithNonretainedObject:download];
    if (![self.observedDownloads containsObject:key]) {
        [download.progress addObserver:self forKeyPath:@"fractionCompleted" options:NSKeyValueObservingOptionNew context:(__bridge void *)download];
        [self.observedDownloads addObject:key];
    }
}

- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)suggestedFilename completionHandler:(void (^)(NSURL * _Nullable))completionHandler API_AVAILABLE(macos(11.3)) {
    if (self.smokeDownloadURL) {
        NSURL *destination = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"feather-webkit-%d-%@", getpid(), suggestedFilename]]];
        [NSFileManager.defaultManager removeItemAtURL:destination error:nil];
        self.downloadDestinations[[NSValue valueWithNonretainedObject:download]] = destination;
        completionHandler(destination);
        return;
    }
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.title = [NSString stringWithFormat:@"Download %@", suggestedFilename];
    panel.nameFieldStringValue = suggestedFilename;
    panel.directoryURL = [NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory inDomains:NSUserDomainMask].firstObject;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK) {
            if ([NSFileManager.defaultManager fileExistsAtPath:panel.URL.path]) {
                [NSFileManager.defaultManager removeItemAtURL:panel.URL error:nil];
            }
            self.downloadDestinations[[NSValue valueWithNonretainedObject:download]] = panel.URL;
            completionHandler(panel.URL);
        } else completionHandler(nil);
    }];
}

- (void)downloadDidFinish:(WKDownload *)download API_AVAILABLE(macos(11.3)) {
    NSValue *key = [NSValue valueWithNonretainedObject:download];
    NSURL *destination = self.downloadDestinations[key];
    [self finishObservingDownload:download];
    if (self.downloadsMenu.numberOfItems == 1 && !self.downloadsMenu.itemArray.firstObject.enabled) [self.downloadsMenu removeAllItems];
    if (destination) {
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:destination.lastPathComponent action:@selector(openDownloadedFile:) keyEquivalent:@""];
        item.target = self;
        item.representedObject = destination;
        [self.downloadsMenu insertItem:item atIndex:0];
        self.downloadsButton.contentTintColor = [NSColor systemGreenColor];
        self.downloadsButton.toolTip = [NSString stringWithFormat:@"Downloaded %@", destination.lastPathComponent];
        if (self.smokeDownloadURL) {
            [NSFileManager.defaultManager removeItemAtURL:destination error:nil];
            fprintf(stdout, "FEATHER_WEBKIT_DOWNLOAD_OK\n");
            fflush(stdout);
            [NSApp terminate:nil];
        }
    }
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData API_AVAILABLE(macos(11.3)) {
    [self finishObservingDownload:download];
    self.downloadsButton.contentTintColor = [NSColor systemRedColor];
    self.downloadsButton.toolTip = @"Download failed";
    if (self.smokeDownloadURL) {
        fprintf(stdout, "FEATHER_WEBKIT_DOWNLOAD_FAILED\n");
        fflush(stdout);
        [NSApp terminate:nil];
        return;
    }
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Download failed";
    alert.informativeText = error.localizedDescription;
    [alert beginSheetModalForWindow:self.window completionHandler:nil];
}

- (void)finishObservingDownload:(WKDownload *)download API_AVAILABLE(macos(11.3)) {
    NSValue *key = [NSValue valueWithNonretainedObject:download];
    if ([self.observedDownloads containsObject:key]) {
        [download.progress removeObserver:self forKeyPath:@"fractionCompleted" context:(__bridge void *)download];
        [self.observedDownloads removeObject:key];
    }
    [self.downloadDestinations removeObjectForKey:key];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        FeatherBrowserDelegate *delegate = [[FeatherBrowserDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
