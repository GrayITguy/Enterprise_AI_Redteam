import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, Copy, CheckCircle, Plus } from "lucide-react";
import { useState } from "react";

export default function Settings() {
  const { user } = useAuthStore();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  const createInviteMutation = useMutation({
    mutationFn: () => api.post("/auth/invite", { expiresInDays: 7 }),
    onSuccess: (res) => {
      setInviteResult(res.data.code);
    },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Platform configuration and user management</p>
      </div>

      {/* Current user */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{user?.email}</p>
              <p className="text-sm text-muted-foreground capitalize">{user?.role} account</p>
            </div>
            <Badge variant={user?.role === "admin" ? "default" : "secondary"} className="capitalize">
              {user?.role}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Invite codes (admin only) */}
      {user?.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Team Invites
            </CardTitle>
            <CardDescription>
              Generate invite codes to add team members. Codes expire after 7 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => createInviteMutation.mutate()}
              disabled={createInviteMutation.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              {createInviteMutation.isPending ? "Generating..." : "Generate Invite Code"}
            </Button>

            {inviteResult && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium mb-1">Invite code generated</p>
                      <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                        {inviteResult}
                      </code>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyCode(inviteResult)}
                    >
                      {copiedCode === inviteResult ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Share this code with your team member. They'll need it to register at /setup.
                    Valid for 7 days.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Enterprise AI Red Team Platform v1.0.0</p>
          <p>
            Combines{" "}
            {["Promptfoo", "Garak", "PyRIT", "DeepTeam"].map((t, i, arr) => (
              <span key={t}>
                <span className="text-foreground">{t}</span>
                {i < arr.length - 1 ? ", " : ""}
              </span>
            ))}{" "}
            in one dashboard.
          </p>
          <p>MIT License — enterpriseairedteam.com</p>
        </CardContent>
      </Card>
    </div>
  );
}
