#import <Cocoa/Cocoa.h>

static void DrawText(NSString *text, NSRect rect, NSFont *font, NSColor *color, NSTextAlignment alignment) {
    NSMutableParagraphStyle *paragraph = [[NSMutableParagraphStyle alloc] init];
    paragraph.alignment = alignment;
    paragraph.lineBreakMode = NSLineBreakByWordWrapping;
    [text drawInRect:rect withAttributes:@{
        NSFontAttributeName: font,
        NSForegroundColorAttributeName: color,
        NSParagraphStyleAttributeName: paragraph
    }];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 4) {
            fprintf(stderr, "Usage: make-dmg-background <output.png> <product> <accent>\n");
            return 2;
        }

        NSString *outputPath = [NSString stringWithUTF8String:argv[1]];
        NSString *product = [NSString stringWithUTF8String:argv[2]];
        NSString *accentName = [NSString stringWithUTF8String:argv[3]];
        NSColor *accent = [accentName isEqualToString:@"green"]
            ? [NSColor colorWithSRGBRed:0.48 green:0.89 blue:0.66 alpha:1]
            : [NSColor colorWithSRGBRed:0.96 green:0.27 blue:0.29 alpha:1];

        NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes:NULL
            pixelsWide:640
            pixelsHigh:420
            bitsPerSample:8
            samplesPerPixel:4
            hasAlpha:YES
            isPlanar:NO
            colorSpaceName:NSCalibratedRGBColorSpace
            bytesPerRow:0
            bitsPerPixel:0];
        NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:context];

        NSRect canvas = NSMakeRect(0, 0, 640, 420);
        NSGradient *background = [[NSGradient alloc] initWithColors:@[
            [NSColor colorWithSRGBRed:0.035 green:0.043 blue:0.041 alpha:1],
            [NSColor colorWithSRGBRed:0.075 green:0.09 blue:0.083 alpha:1]
        ]];
        [background drawInRect:canvas angle:-25];

        [[accent colorWithAlphaComponent:0.09] setFill];
        [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(30, 120, 280, 280)] fill];
        [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(405, 180, 250, 250)] fill];

        [[NSColor.whiteColor colorWithAlphaComponent:0.055] setStroke];
        for (NSInteger x = 0; x <= 640; x += 40) {
            NSBezierPath *line = [NSBezierPath bezierPath];
            [line moveToPoint:NSMakePoint(x, 0)];
            [line lineToPoint:NSMakePoint(x, 420)];
            line.lineWidth = 0.5;
            [line stroke];
        }
        for (NSInteger y = 0; y <= 420; y += 40) {
            NSBezierPath *line = [NSBezierPath bezierPath];
            [line moveToPoint:NSMakePoint(0, y)];
            [line lineToPoint:NSMakePoint(640, y)];
            line.lineWidth = 0.5;
            [line stroke];
        }

        DrawText([NSString stringWithFormat:@"Install %@", product], NSMakeRect(70, 340, 500, 42), [NSFont systemFontOfSize:28 weight:NSFontWeightBold], NSColor.whiteColor, NSTextAlignmentCenter);
        DrawText([NSString stringWithFormat:@"Drag %@ into Applications", product], NSMakeRect(90, 310, 460, 24), [NSFont systemFontOfSize:14 weight:NSFontWeightMedium], [NSColor.whiteColor colorWithAlphaComponent:0.67], NSTextAlignmentCenter);

        NSBezierPath *arrow = [NSBezierPath bezierPath];
        [arrow moveToPoint:NSMakePoint(260, 205)];
        [arrow lineToPoint:NSMakePoint(380, 205)];
        [arrow moveToPoint:NSMakePoint(365, 216)];
        [arrow lineToPoint:NSMakePoint(380, 205)];
        [arrow lineToPoint:NSMakePoint(365, 194)];
        arrow.lineWidth = 3;
        arrow.lineCapStyle = NSLineCapStyleRound;
        arrow.lineJoinStyle = NSLineJoinStyleRound;
        [[accent colorWithAlphaComponent:0.9] setStroke];
        [arrow stroke];

        NSRect noteRect = NSMakeRect(60, 26, 520, 58);
        NSBezierPath *note = [NSBezierPath bezierPathWithRoundedRect:noteRect xRadius:14 yRadius:14];
        [[NSColor.blackColor colorWithAlphaComponent:0.28] setFill];
        [note fill];
        [[accent colorWithAlphaComponent:0.28] setStroke];
        note.lineWidth = 1;
        [note stroke];
        DrawText(@"FIRST LAUNCH", NSMakeRect(80, 55, 100, 15), [NSFont monospacedSystemFontOfSize:9 weight:NSFontWeightBold], accent, NSTextAlignmentLeft);
        DrawText(@"Control-click the app in Applications, choose Open, then Open again.", NSMakeRect(80, 37, 480, 18), [NSFont systemFontOfSize:11 weight:NSFontWeightMedium], [NSColor.whiteColor colorWithAlphaComponent:0.72], NSTextAlignmentLeft);

        [context flushGraphics];
        [NSGraphicsContext restoreGraphicsState];
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (![png writeToFile:outputPath atomically:YES]) {
            fprintf(stderr, "Could not write installer background.\n");
            return 1;
        }
    }
    return 0;
}
