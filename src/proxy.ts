import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Optimistic gate for signed-in pages. Real authorization happens in Convex
// functions; this just redirects signed-out visitors before rendering.
const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
