# Temporary Talkaton maintenance release

Deploy this directory as the Vercel project root for both Talkaton and subscriptions. Every route returns the maintenance page with HTTP 503 and no caching. Existing service workers receive a network-only update. Original application source and user data are preserved.

To reopen the application, deploy the tested application Git commit and restore its project root/build settings. Do not restore traffic until the required service configuration is verified.
