"use client";

import { useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@repo/trpc/client";
import { signInInputSchema, signUpInputSchema } from "@repo/services/auth/dtos";
import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { sanitizeRedirectPath } from "@repo/services/auth/safe-redirect";
import { env } from "~/env";
import { isDemoLoginEnabled } from "~/lib/demo-config";
import { trpc } from "~/trpc/client";
import { ThreadLogoMark } from "./thread-logo";

type AuthMode = "sign-in" | "sign-up";

type ThreadAuthCardProps = {
  mode: AuthMode;
  onModeChange?: (mode: AuthMode) => void;
  nextPath?: string;
  onSuccess?: () => void;
  errorMessage?: string;
  /** Set when redirected from sign-in after password login triggers 2FA */
  pendingTwoFactorEmail?: string;
};

type SignInValues = z.infer<typeof signInInputSchema>;
type SignUpValues = z.infer<typeof signUpInputSchema>;

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function AuthFormPlaceholder({ fields = 2 }: { fields?: number }) {
  return (
    <div className="thread-auth-form thread-auth-form-placeholder" aria-hidden>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="thread-auth-input thread-auth-input-placeholder" />
      ))}
      <div className="thread-auth-submit thread-auth-submit-placeholder" />
    </div>
  );
}

export function ThreadAuthCard({
  mode,
  onModeChange,
  nextPath = "/brief",
  onSuccess,
  errorMessage,
  pendingTwoFactorEmail,
}: ThreadAuthCardProps) {
  const isLogin = mode === "sign-in";
  const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const turnstileEnabled = Boolean(turnstileSiteKey);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(errorMessage ?? "");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [twoFactorStep, setTwoFactorStep] = useState<{
    email: string;
    displayEmail: string;
    otp: string;
  } | null>(null);

  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInInputSchema),
    defaultValues: { email: "", password: "" },
  });

  const signUpForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpInputSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  const signUpMutation = trpc.auth.signUp.useMutation();
  const signInMutation = trpc.auth.signIn.useMutation();
  const verify2FAMutation = trpc.auth.verify2FA.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (errorMessage) setError(errorMessage);
  }, [errorMessage]);

  useEffect(() => {
    const email = pendingTwoFactorEmail?.trim();
    if (!email) return;
    setTwoFactorStep({ email, displayEmail: email, otp: "" });
    toast.info("Enter the verification code we sent to your email.");
  }, [pendingTwoFactorEmail]);

  useEffect(() => {
    setTurnstileToken(null);
    turnstileRef.current?.reset();
  }, [mode]);

  const resetTurnstile = () => {
    setTurnstileToken(null);
    turnstileRef.current?.reset();
  };

  const requireTurnstileToken = () => {
    if (!turnstileEnabled) return true;
    if (turnstileToken) return true;
    setError("Complete the security check and try again.");
    return false;
  };

  const getErrorMessage = (err: unknown) => {
    if (err instanceof TRPCClientError) return err.message;
    if (err instanceof Error) return err.message;
    return "Something went wrong";
  };

  const completeSignIn = async () => {
    await utils.auth.me.invalidate();
    onSuccess?.();
    window.location.assign(sanitizeRedirectPath(nextPath));
  };

  const handleSubmit = isLogin
    ? signInForm.handleSubmit(async (values) => {
        if (!requireTurnstileToken()) return;
        setLoading(true);
        setError("");
        try {
          const result = await signInMutation.mutateAsync({
            ...values,
            turnstileToken: turnstileToken ?? undefined,
          });
          if (result.twoFactorRequired) {
            setTwoFactorStep({
              email: result.email,
              displayEmail: values.email.trim() || result.email,
              otp: "",
            });
            toast.info(result.message);
            return;
          }
          await completeSignIn();
        } catch (err) {
          setError(getErrorMessage(err));
          resetTurnstile();
        } finally {
          setLoading(false);
        }
      })
    : signUpForm.handleSubmit(async (values) => {
        if (!requireTurnstileToken()) return;
        setLoading(true);
        setError("");
        try {
          await signUpMutation.mutateAsync({
            ...values,
            turnstileToken: turnstileToken ?? undefined,
          });
          toast.success("Account created — verify your email to continue");
          window.location.assign(`/check-email?email=${encodeURIComponent(values.email)}`);
        } catch (err) {
          const message = getErrorMessage(err);
          setError(message);
          resetTurnstile();
          if (message.toLowerCase().includes("verify your email")) {
            window.location.assign(`/check-email?email=${encodeURIComponent(values.email)}`);
          }
        } finally {
          setLoading(false);
        }
      });

  const handleTwoFactorSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!twoFactorStep) return;
    setLoading(true);
    setError("");
    try {
      await verify2FAMutation.mutateAsync({
        email: twoFactorStep.email,
        otp: twoFactorStep.otp,
      });
      await completeSignIn();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const googleHref = `/api-auth/google?state=${encodeURIComponent(sanitizeRedirectPath(nextPath))}`;

  return (
    <div className="thread-auth-card">
      <div className="thread-auth-logo">
        <ThreadLogoMark size={52} />
      </div>

      <h1 className="thread-auth-title">
        {twoFactorStep ? "Enter verification code" : isLogin ? "Log in to Thread" : "Create your account"}
      </h1>

      {error && !mounted && <p className="thread-auth-error">{error}</p>}

      {!mounted ? (
        <>
          <div className="thread-auth-google-wide thread-auth-google-placeholder" aria-hidden />
          <p className="thread-auth-or">or</p>
          <AuthFormPlaceholder fields={isLogin ? 2 : 4} />
          <div className="thread-auth-footer thread-auth-footer-placeholder" aria-hidden />
        </>
      ) : (
        <>
          {!twoFactorStep && (
            <>
              <a href={googleHref} className="thread-auth-google-wide">
                <GoogleIcon size={18} />
                Continue with Google
              </a>
              {isLogin && isDemoLoginEnabled() ? (
                <a
                  href={`/api-auth/demo?next=${encodeURIComponent(sanitizeRedirectPath(nextPath))}`}
                  className="thread-auth-demo-wide"
                >
                  Try demo — no signup
                </a>
              ) : null}
              <p className="thread-auth-or">or</p>
            </>
          )}

          <form onSubmit={twoFactorStep ? handleTwoFactorSubmit : handleSubmit} className="thread-auth-form">
        {twoFactorStep ? (
          <>
            <p className="thread-auth-hint">Code sent to {twoFactorStep.displayEmail}</p>
            <input
              className="thread-auth-input"
              name="otp"
              type="text"
              value={twoFactorStep.otp}
              onChange={(e) =>
                setTwoFactorStep((prev) => (prev ? { ...prev, otp: e.target.value } : prev))
              }
              placeholder="123456"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
            />
          </>
        ) : isLogin ? (
          <>
            <input
              className="thread-auth-input"
              type="email"
              placeholder="Email address"
              value={signInForm.watch("email")}
              onChange={(e) => {
                signInForm.setValue("email", e.target.value, { shouldValidate: true });
                setError("");
              }}
              required
              autoComplete="email"
            />
            <input
              className="thread-auth-input"
              type="password"
              placeholder="Password"
              value={signInForm.watch("password")}
              onChange={(e) => {
                signInForm.setValue("password", e.target.value, { shouldValidate: true });
                setError("");
              }}
              required
              autoComplete="current-password"
            />
          </>
        ) : (
          <>
            <input
              className="thread-auth-input"
              type="text"
              placeholder="Full name"
              value={signUpForm.watch("fullName")}
              onChange={(e) => {
                signUpForm.setValue("fullName", e.target.value, { shouldValidate: true });
                setError("");
              }}
              required
              autoComplete="name"
            />
            <input
              className="thread-auth-input"
              type="email"
              placeholder="Email address"
              value={signUpForm.watch("email")}
              onChange={(e) => {
                signUpForm.setValue("email", e.target.value, { shouldValidate: true });
                setError("");
              }}
              required
              autoComplete="email"
            />
            <input
              className="thread-auth-input"
              type="password"
              placeholder="Password"
              value={signUpForm.watch("password")}
              onChange={(e) => {
                signUpForm.setValue("password", e.target.value, { shouldValidate: true });
                setError("");
              }}
              required
              autoComplete="new-password"
            />
            <input
              className="thread-auth-input"
              type="password"
              placeholder="Confirm password"
              value={signUpForm.watch("confirmPassword")}
              onChange={(e) => {
                signUpForm.setValue("confirmPassword", e.target.value, { shouldValidate: true });
                setError("");
              }}
              required
              autoComplete="new-password"
            />
          </>
        )}

        {(error ||
          signInForm.formState.errors.email?.message ||
          signInForm.formState.errors.password?.message ||
          signUpForm.formState.errors.email?.message) && (
          <p className="thread-auth-error">{error || "Check your details and try again."}</p>
        )}

            <button type="submit" className="thread-auth-submit" disabled={loading || (turnstileEnabled && !turnstileToken && !twoFactorStep)}>
              {loading ? "Please wait…" : twoFactorStep ? "Verify" : isLogin ? "Sign in" : "Create account"}
            </button>
          </form>

          {!twoFactorStep && (
            <button
              type="button"
              className="thread-auth-footer"
              onClick={() => onModeChange?.(isLogin ? "sign-up" : "sign-in")}
            >
              {isLogin ? (
                <>
                  Don&apos;t have an account? <span>Sign up →</span>
                </>
              ) : (
                <>
                  Already have an account? <span>Log in →</span>
                </>
              )}
            </button>
          )}
        </>
      )}

      {turnstileEnabled && mounted && !twoFactorStep && (
        <div className="thread-auth-turnstile">
          <Turnstile
            ref={turnstileRef}
            siteKey={turnstileSiteKey!}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={() => {
              setTurnstileToken(null);
              setError("Security check failed to load. Refresh and try again.");
            }}
            options={{ theme: "dark", size: "normal", appearance: "always" }}
          />
        </div>
      )}
    </div>
  );
}
