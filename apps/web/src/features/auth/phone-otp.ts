import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";

/**
 * How long the UI keeps "resend" disabled after a code has been sent.
 *
 * This countdown is *ergonomics only*, and that is worth stating out loud: it lives in component
 * state, so a refresh, a second tab or another device all start it over. None of them can bypass
 * anything, because the real limiter is better-auth's rate limit on `/phone-number/send-otp`. When
 * that one trips, the request comes back with `TOO_MANY_REQUESTS` and a Chinese message carrying
 * the actual wait ("请 X 秒后再试"), which we surface verbatim (see `getReadableErrorMessage`).
 */
const RESEND_COOLDOWN_SECONDS = 60;

export type PhoneOtp = {
	/** The number the last successful request sent a code to. */
	phoneNumber: string;
	/** `true` once a code has been handed off — the form switches to its second step. */
	hasSentCode: boolean;
	/** `true` while an `send-otp` request is in flight, so buttons can be disabled. */
	isSending: boolean;
	/** Seconds left before the UI allows another request; `0` means resending is enabled. */
	secondsLeft: number;
	/** Requests a code for `phoneNumber` and moves to step two. Returns whether it worked. */
	send: (phoneNumber: string) => Promise<boolean>;
	/** Back to step one: forget the number and drop the countdown. */
	reset: () => void;
};

export function usePhoneOtp(): PhoneOtp {
	const [phoneNumber, setPhoneNumber] = useState("");
	const [hasSentCode, setHasSentCode] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [secondsLeft, setSecondsLeft] = useState(0);

	const isCoolingDown = secondsLeft > 0;

	useEffect(() => {
		if (!isCoolingDown) return;

		// One interval covers the whole cooldown; the last tick flips `isCoolingDown` off, which
		// re-runs this effect and clears the timer.
		const timer = setInterval(() => setSecondsLeft((seconds) => Math.max(seconds - 1, 0)), 1000);

		return () => clearInterval(timer);
	}, [isCoolingDown]);

	const send = useCallback(
		async (value: string): Promise<boolean> => {
			// The button is disabled during the cooldown too — this guard only stops double submits
			// from slipping through before React re-renders.
			if (isSending) return false;

			setIsSending(true);

			const toastId = toast.add({ type: "loading", description: t`Sending verification code…` });

			const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: value });

			setIsSending(false);

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when requesting an SMS verification code fails without a server message",
							message: "Failed to send the verification code. Please try again.",
						}),
					),
					id: toastId,
				});
				return false;
			}

			toast.close(toastId);

			setPhoneNumber(value);
			setHasSentCode(true);
			setSecondsLeft(RESEND_COOLDOWN_SECONDS);

			return true;
		},
		[isSending],
	);

	const reset = useCallback(() => {
		setHasSentCode(false);
		setSecondsLeft(0);
	}, []);

	return { phoneNumber, hasSentCode, isSending, secondsLeft, send, reset };
}
