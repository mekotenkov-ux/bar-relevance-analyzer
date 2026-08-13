import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/analyzer", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/"] };
