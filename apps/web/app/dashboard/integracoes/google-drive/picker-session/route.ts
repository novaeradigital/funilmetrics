import { NextRequest, NextResponse } from "next/server";
import {
  exchangeGoogleRefreshToken,
  getAuthorizedDriveConnection,
} from "../../../../../lib/google-drive-access";
import { getDatabase } from "../../../../../lib/database";
import { loadProjectGooglePickerConfig } from "../../../../../lib/google-drive-runtime";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "project_required" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project || active.project.id !== projectId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const picker = await loadProjectGooglePickerConfig(
      getDatabase().pool,
      projectId,
    );
    if (!picker) {
      return NextResponse.json(
        { error: "picker_not_configured" },
        { status: 503 },
      );
    }
    const authorized = await getAuthorizedDriveConnection({
      authUserId: data.user.id,
      projectId,
    });
    if (!authorized) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const token = await exchangeGoogleRefreshToken(
      authorized.config,
      authorized.refreshToken,
    );
    return NextResponse.json(
      {
        accessToken: token.accessToken,
        expiresIn: token.expiresIn,
        apiKey: picker.apiKey,
        appId: picker.appId,
        accountEmail: authorized.connection.accountEmail,
      },
      {
        headers: {
          "cache-control": "no-store, private",
          pragma: "no-cache",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "drive_session_failed" },
      { status: 502 },
    );
  }
}
