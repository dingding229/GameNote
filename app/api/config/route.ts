import { NextResponse } from "next/server";
import { getStatsPlatformScope } from "@/lib/config/app";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    statsPlatforms: getStatsPlatformScope(),
  });
}
