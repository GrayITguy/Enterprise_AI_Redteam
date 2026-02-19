import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Key, Shield, AlertTriangle, ExternalLink } from "lucide-react";

export default function License() {
  const qc = useQueryClient();
  const [licenseKey, setLicenseKey] = useState("");

  const { data: status } = useQuery({
    queryKey: ["license"],
    queryFn: () => api.get("/license").then((r) => r.data as any),
  });

  const activateMutation = useMutation({
    mutationFn: () => api.post("/license/activate", { licenseKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["license"] });
      setLicenseKey("");
    },
  });

  const error = (activateMutation.error as any)?.response?.data?.error;

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">License</h1>
        <p className="text-sm text-muted-foreground">Manage your Enterprise AI Red Team license</p>
      </div>

      {/* Status card */}
      <Card className={status?.isActivated ? "border-green-500/50" : "border-muted"}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-5 w-5" />
              License Status
            </CardTitle>
            <Badge variant={status?.isActivated ? "default" : "outline"} className={status?.isActivated ? "bg-green-500/20 text-green-400 border-green-500/40" : ""}>
              {status?.isActivated ? "Active" : "Unlicensed"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.isActivated ? (
            <>
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">License activated</span>
              </div>
              {status.email && (
                <p className="text-sm text-muted-foreground">Registered to: {status.email}</p>
              )}
              {status.seats && (
                <p className="text-sm text-muted-foreground">Seats: {status.seats}</p>
              )}
              {status.expiresAt && (
                <p className="text-sm text-muted-foreground">
                  Expires: {new Date(status.expiresAt).toLocaleDateString()}
                </p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Running in free mode. Activate a license key to unlock unlimited scans and remove the trial banner.
              </p>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-semibold">Free tier includes:</p>
                {["5 scans per month", "Quick preset only", "PDF reports with watermark"].map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    {f}
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-primary">Licensed ($79 one-time) includes:</p>
                {["Unlimited scans", "All presets + custom plugins", "Clean PDF reports", "Email notifications", "Priority support"].map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-xs text-primary/80">
                    <CheckCircle className="h-3 w-3 text-primary" />
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activation form */}
      {!status?.isActivated && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Activate License
            </CardTitle>
            <CardDescription>
              Enter your license key from enterpriseairedteam.com
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>License Key</Label>
              <Input
                placeholder="Paste your license key here..."
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {activateMutation.isSuccess && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>License activated successfully!</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3">
              <Button
                onClick={() => activateMutation.mutate()}
                disabled={!licenseKey || activateMutation.isPending}
              >
                {activateMutation.isPending ? "Activating..." : "Activate License"}
              </Button>
              <Button variant="outline" asChild>
                <a href="https://enterpriseairedteam.com" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Purchase License
                </a>
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Machine ID: <code className="font-mono">{status?.machineId}</code>
              {" — "}License is bound to this machine.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
