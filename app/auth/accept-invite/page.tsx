"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface InvitationData {
  id: string;
  organization_id: string;
  email: string;
  role: "super_admin" | "admin";
  status: string;
  expires_at: string;
  organization_name?: string;
}

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const [success, setSuccess] = useState(false);
  
  // Password creation state
  const [showPasswordForm, setShowPasswordForm] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const supabase = createClient();

  useEffect(() => {
    validateInvitation();
  }, [token]);

  async function validateInvitation() {
    if (!token) {
      setError("No invitation token provided.");
      setLoading(false);
      return;
    }

    try {
      // Check if user is logged in
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email) {
        setCurrentUserEmail(user.email);
      }

      // Fetch invitation by token
      const { data: invite, error: inviteError } = await supabase
        .from("organization_invitations")
        .select("id, organization_id, email, role, status, expires_at")
        .eq("invitation_token", token)
        .single();

      if (inviteError) {
        console.error("Invitation fetch error:", inviteError);
        console.error("Full error details:", JSON.stringify(inviteError, null, 2));
        setError(`Database error: ${inviteError.message || JSON.stringify(inviteError)}`);
        setLoading(false);
        return;
      }

      if (!invite) {
        setError("Invalid or expired invitation link.");
        setLoading(false);
        return;
      }

      // Fetch organization name separately
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", invite.organization_id)
        .single();

      // Add organization name to invite
      const inviteWithOrg = {
        ...invite,
        organizations: org,
      };

      // Check if invitation is still pending
      if (inviteWithOrg.status !== "pending") {
        if (inviteWithOrg.status === "accepted") {
          setError("This invitation has already been accepted.");
        } else if (inviteWithOrg.status === "expired") {
          setError("This invitation has expired.");
        } else if (inviteWithOrg.status === "revoked") {
          setError("This invitation has been revoked.");
        }
        setLoading(false);
        return;
      }

      // Check if invitation has expired
      const expiresAt = new Date(inviteWithOrg.expires_at);
      if (expiresAt < new Date()) {
        // Mark as expired
        await supabase
          .from("organization_invitations")
          .update({ status: "expired" })
          .eq("id", inviteWithOrg.id);

        setError("This invitation has expired.");
        setLoading(false);
        return;
      }

      // SECURITY: Check email match if user is logged in
      if (user?.email) {
        if (user.email.toLowerCase() !== inviteWithOrg.email.toLowerCase()) {
          setEmailMismatch(true);
          setInvitation({
            ...inviteWithOrg,
            organization_name: inviteWithOrg.organizations?.name,
          });
          setError(
            `This invite was sent to ${inviteWithOrg.email}, but you're logged in as ${user.email}. Please log out and log in with the invited email.`
          );
          setLoading(false);
          return;
        }
      }

      // Valid invitation
      setInvitation({
        ...inviteWithOrg,
        organization_name: inviteWithOrg.organizations?.name,
      });
      setLoading(false);

      // Auto-accept if user is logged in and email matches
      if (user?.email && user.email.toLowerCase() === inviteWithOrg.email.toLowerCase()) {
        await handleAcceptInvite();
      }
    } catch (err: any) {
      console.error("Error validating invitation:", err);
      setError("Failed to validate invitation. Please try again.");
      setLoading(false);
    }
  }

  async function handleAcceptInvite() {
    if (!invitation) return;

    setAccepting(true);

    try {
      // Check if user is logged in
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        // Redirect to sign-in with token preserved
        const signInUrl = `/auth/signin?redirectTo=${encodeURIComponent(
          `/auth/accept-invite?token=${token}`
        )}`;
        router.push(signInUrl);
        return;
      }

      // SECURITY: Double-check email match
      if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
        setError(
          `This invite was sent to ${invitation.email}, but you're logged in as ${user.email}. Please log out and log in with the correct email.`
        );
        setAccepting(false);
        return;
      }

      // Check if user is already a member
      const { data: existingMembership } = await supabase
        .from("organization_memberships")
        .select("id")
        .eq("organization_id", invitation.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingMembership) {
        setError("You are already a member of this organization.");
        setAccepting(false);
        return;
      }

      // Create membership
      const { error: membershipError } = await supabase
        .from("organization_memberships")
        .insert({
          organization_id: invitation.organization_id,
          user_id: user.id,
          role: invitation.role,
          invited_by: null, // Could track from invitation if needed
          invited_at: new Date().toISOString(),
          joined_at: new Date().toISOString(),
        });

      if (membershipError) {
        console.error("Failed to create membership:", membershipError);
        setError("Failed to join organization. Please contact support.");
        setAccepting(false);
        return;
      }

      // Update invitation status to accepted
      const { error: updateError } = await supabase
        .from("organization_invitations")
        .update({ status: "accepted" })
        .eq("id", invitation.id);

      if (updateError) {
        console.error("Failed to update invitation status:", updateError);
        // Don't fail here - membership was created successfully
      }

      // Success!
      setSuccess(true);
      toast.success(`Welcome to ${invitation.organization_name || "the organization"}!`);
      
      // Redirect to dashboard after short delay
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (err: any) {
      console.error("Error accepting invitation:", err);
      setError("Failed to accept invitation. Please try again.");
      setAccepting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    // Preserve token in URL after sign out
    router.push(`/auth/signin?redirectTo=${encodeURIComponent(`/auth/accept-invite?token=${token}`)}`);
  }

  async function handleSignUpAndAccept() {
    // Validate passwords match
    if (password !== confirmPassword) {
      setPasswordError("Passwords don't match");
      return;
    }

    // Validate password strength (minimum 8 chars for Supabase)
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    setPasswordError('');
    setAccepting(true);

    try {
      // Attempt to sign up
      const { data, error } = await supabase.auth.signUp({
        email: invitation!.email,
        password: password,
      });

      if (error) {
        // Check if user already exists (prefer error.code if available)
        if (error.code === 'user_already_exists' ||
            error.message.includes('already registered') || 
            error.message.includes('User already registered')) {
          // Existing user - show sign-in prompt
          setError(
            'This email already has an account. Please sign in to accept this invite.'
          );
          setShowPasswordForm(false);
          setAccepting(false);
          return;
        }
        
        // Other error
        setPasswordError(error.message);
        setAccepting(false);
        return;
      }

      // Check if email confirmation is required
      if (data?.user && !data.session) {
        // Email confirmation required
        setError(
          'Please check your email to confirm your account, then click the invite link again.'
        );
        setAccepting(false);
        return;
      }

      // Successfully created account
      // Wait a moment for session to establish
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Now accept the invite with the new account
      await handleAcceptInvite();
      
    } catch (err: any) {
      console.error('Signup error:', err);
      setPasswordError('Failed to create account. Please try again.');
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
          <p className="text-gray-600">Validating invitation...</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Welcome to {invitation?.organization_name || "the organization"}!
          </h1>
          <p className="text-gray-600 mb-6">
            You've successfully joined as a {invitation?.role === "super_admin" ? "Super Admin" : "Admin"}.
          </p>
          <p className="text-sm text-gray-500">
            Redirecting to dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
          <div className="flex items-start gap-3 mb-6">
            {emailMismatch ? (
              <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-1" />
            ) : (
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
            )}
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900 mb-2">
                {emailMismatch ? "Email Mismatch" : "Invalid Invitation"}
              </h1>
              <p className="text-gray-600 mb-4">{error}</p>
              
              {emailMismatch && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-amber-800 mb-2">
                    <strong>Invited email:</strong> {invitation?.email}
                  </p>
                  <p className="text-sm text-amber-800 mb-3">
                    <strong>Your email:</strong> {currentUserEmail}
                  </p>
                  <button
                    onClick={handleSignOut}
                    className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
                  >
                    Sign Out and Use Invited Email
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-gray-600">No invitation found.</p>
        </div>
      </div>
    );
  }

  // Show accept screen if user is not logged in
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Join {invitation.organization_name}
          </h1>
          <p className="text-gray-600">
            You've been invited as a{" "}
            <span className="font-semibold">
              {invitation.role === "super_admin" ? "Super Admin" : "Admin"}
            </span>
          </p>
        </div>

        {showPasswordForm ? (
          // State 1: New User - Show password creation form
          <>
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={invitation.email}
                disabled
                className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-700 cursor-not-allowed"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Create Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            {passwordError && (
              <p className="text-sm text-red-600 mb-4">{passwordError}</p>
            )}

            <button
              onClick={handleSignUpAndAccept}
              disabled={accepting}
              className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {accepting && <Loader2 className="w-5 h-5 animate-spin" />}
              {accepting ? "Creating Account..." : "Create Account & Join"}
            </button>
          </>
        ) : (
          // State 2: Existing User - Show sign-in button
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-800 mb-3">
                This email already has an account. Please sign in to accept this invite.
              </p>
              <button
                onClick={() => {
                  const redirectTo = `/auth/accept-invite?token=${token}`;
                  router.push(
                    `/auth/signin?redirectTo=${encodeURIComponent(redirectTo)}`
                  );
                }}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Sign In to Accept Invite
              </button>
            </div>
          </>
        )}

        <p className="text-xs text-gray-500 text-center mt-4">
          This invitation expires on{" "}
          {new Date(invitation.expires_at).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <Loader2 className="w-12 h-12 animate-spin text-green-600" />
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}

