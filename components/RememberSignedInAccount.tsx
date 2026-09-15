"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { providerFromUser, rememberAccount } from "@/lib/rememberedAccounts";

/** Persist the signed-in user for the auth modal “Welcome back” picker. */
export default function RememberSignedInAccount() {
  useEffect(() => {
    const supabase = createClient();

    const save = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) return;

      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const name =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        null;

      rememberAccount({
        email: user.email,
        name,
        provider: providerFromUser(user),
      });
    };

    void save();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      if (!user?.email) return;
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const name =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        null;
      rememberAccount({
        email: user.email,
        name,
        provider: providerFromUser(user),
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
