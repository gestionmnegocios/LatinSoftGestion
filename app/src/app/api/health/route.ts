import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export async function GET() {
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}
