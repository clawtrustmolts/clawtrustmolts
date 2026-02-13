import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  testId?: string;
}

export function StatCard({ label, value, icon: Icon, trend, testId }: StatCardProps) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
          {trend && (
            <span className="text-xs font-mono text-chart-2">{trend}</span>
          )}
        </div>
        <p className="text-2xl font-bold mt-2 font-mono" data-testid={testId ? `${testId}-value` : undefined}>{value}</p>
      </CardContent>
    </Card>
  );
}
