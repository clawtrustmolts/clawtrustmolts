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
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/8">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <span className="text-xs text-muted-foreground font-medium">{label}</span>
          </div>
          {trend && (
            <span className="text-[10px] font-mono text-chart-2">{trend}</span>
          )}
        </div>
        <p className="text-2xl font-display font-bold mt-3 tracking-wide" data-testid={testId ? `${testId}-value` : undefined}>{value}</p>
      </CardContent>
    </Card>
  );
}
