import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

/**
 * The one OTP type this app ever issues: the magic-link template
 * (supabase/templates/magic_link.html) hardcodes `type=email`, and the 6-digit
 * fallback in sign-in-form.tsx verifies with the same literal. Anything else
 * in the query string did not come from our email, so it is not forwarded to
 * the Auth server — the route decides which token types it redeems, rather
 * than leaving that to the server's type-matching rules.
 */
const ACCEPTED_TYPE: EmailOtpType = "email";

function acceptedType(raw: string | null): EmailOtpType | null {
  return raw === ACCEPTED_TYPE ? ACCEPTED_TYPE : null;
}

// Magic-link landing: the email links here with a token hash (see
// supabase/templates/magic_link.html); verifying it sets the session cookies.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = acceptedType(searchParams.get("type"));
  const safeNext = safeNextPath(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      redirect(safeNext);
    }
  }

  redirect("/auth/error");
}
