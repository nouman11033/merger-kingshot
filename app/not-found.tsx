import Link from "next/link";

import { Button, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-4">
      <Card className="w-full p-6 text-center">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">404</p>
        <h1 className="font-heading mt-1 text-lg font-bold text-foreground">Merge session not found</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This session may have been deleted, or the link is incorrect.
        </p>
        <Button asChild className="mt-4" variant="primary">
          <Link href="/">Back to all sessions</Link>
        </Button>
      </Card>
    </main>
  );
}
