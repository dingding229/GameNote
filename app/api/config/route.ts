import { NextResponse } from "next/server";
import { getStatsPlatformScope } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    statsPlatforms: getStatsPlatformScope(),
  });
}
