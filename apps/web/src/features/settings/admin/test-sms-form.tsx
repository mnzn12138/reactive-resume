import type { FormEvent } from "react";
import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type SendResult = RouterOutput["sms"]["sendTest"];

/**
 * Sends one real message through the configured vendor.
 *
 * The result is rendered in full, `vendorCode` included, because that code is
 * the only thing an operator can paste into the vendor's own console. It is also
 * why the endpoint returns a vendor refusal as data instead of throwing: a
 * generic "something went wrong" toast would hide the one field that matters.
 *
 * This deliberately shares the code path a verification code takes (rate windows
 * and send log included), so a test message is not a way around the limits it is
 * supposed to be checking.
 */
export function TestSmsForm() {
	const [phoneNumber, setPhoneNumber] = useState("");
	const [result, setResult] = useState<SendResult | null>(null);

	const sendTest = useMutation(
		orpc.sms.sendTest.mutationOptions({
			onSuccess: (data) => setResult(data),
			onError: (error) =>
				toast.add({
					type: "error",
					description: getReadableErrorMessage(error, t`Could not send the test message. Please try again.`),
				}),
		}),
	);

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		event.stopPropagation();

		setResult(null);
		sendTest.mutate({ phoneNumber });
	};

	return (
		<div className="flex flex-col gap-3">
			<form className="flex items-center gap-2" onSubmit={onSubmit}>
				<Input
					type="tel"
					inputMode="tel"
					autoComplete="tel"
					placeholder="13800138000"
					aria-label={t`Phone number`}
					className="max-w-56"
					value={phoneNumber}
					onChange={(event) => setPhoneNumber(event.currentTarget.value)}
				/>

				<Button type="submit" variant="outline" disabled={sendTest.isPending || phoneNumber.trim() === ""}>
					<PaperPlaneTiltIcon />
					<Trans comment="Admin console action that sends one test SMS through the configured vendor">
						Send test message
					</Trans>
				</Button>
			</form>

			{result && (
				<div className="flex flex-col items-start gap-1 rounded-lg border bg-background p-3">
					<Badge variant={result.ok ? "default" : "destructive"}>
						{result.ok ? (
							<Trans comment="Admin console confirmation that the vendor accepted the test SMS">Accepted</Trans>
						) : (
							<Trans comment="Admin console label for a test SMS the vendor refused">Failed</Trans>
						)}
					</Badge>

					{/* The vendor's own code: the only thing that can be looked up in their console. */}
					<p className="font-mono text-muted-foreground text-xs">
						{result.ok
							? `${result.vendorMessageId} · ${result.vendorRequestId}`
							: `${result.code} · ${result.vendorCode}`}
					</p>

					{!result.ok && <p className="text-muted-foreground text-xs">{result.message}</p>}
				</div>
			)}
		</div>
	);
}
