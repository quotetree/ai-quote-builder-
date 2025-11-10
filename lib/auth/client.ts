/**
 * Client-side auth utilities
 * Safe to use in React components
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface UserRef {
  id: string;
  email?: string;
  name?: string;
}

/**
 * React hook to get the current authenticated user (client-side)
 * Returns null if not authenticated or still loading
 */
export function useCurrentUser(): UserRef | null {
  const [user, setUser] = useState<UserRef | null>(null);
  const supabase = createClient();

  useEffect(() => {
    // Get initial user
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUser({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email
        });
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.full_name || session.user.email
        });
      } else {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  return user;
}

/**
 * Get current user synchronously (for use in callbacks/handlers)
 * Returns a promise that resolves to UserRef or null
 */
export async function getCurrentUserClient(): Promise<UserRef | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return null;
  
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || user.email
  };
}

/**
 * Get anonymous user ref for fallback cases
 */
export function getAnonymousUser(): UserRef {
  return {
    id: 'anonymous',
    email: 'anonymous@local',
    name: 'Anonymous'
  };
}

