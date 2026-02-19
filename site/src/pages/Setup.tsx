import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, CheckCircle, AlertTriangle } from "lucide-react";

export default function Setup() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/auth/setup", { email, password });
      return res.data as { token: string; user: { id: string; email: string; role: "admin" | "analyst" | "viewer" } };
    },
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      navigate("/dashboard");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return;
    setupMutation.mutate();
  };

  const passwordMismatch = confirm.length > 0 && password !== confirm;
  const error = (setupMutation.error as any)?.response?.data?.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Shield className="h-7 w-7 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold">First-Time Setup</h1>
            <p className="text-sm text-muted-foreground">
              Create your admin account to get started
            </p>
          </div>
        </div>

        {/* Setup steps */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
          {[
            "Create admin account",
            "Add your first target project",
            "Run your first security scan",
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {i + 1}
              </div>
              <span className={i === 0 ? "text-foreground" : "text-muted-foreground"}>
                {step}
              </span>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Admin Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm Password</Label>
            <Input
              id="confirm"
              type="password"
              placeholder="Re-enter password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className={passwordMismatch ? "border-destructive" : ""}
            />
            {passwordMismatch && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={setupMutation.isPending || passwordMismatch || !email || !password}
          >
            {setupMutation.isPending ? "Creating account..." : "Create Admin Account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
