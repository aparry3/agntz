interface ValidationError {
  level: string;
  path: string;
  message: string;
}

interface ValidationWarning {
  path: string;
  message: string;
}

interface ValidationBannerProps {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export function ValidationBanner({ errors, warnings }: ValidationBannerProps) {
  if (errors.length === 0 && warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-700">
            {errors.length} Error{errors.length !== 1 && "s"}
          </div>
          <div className="space-y-1">
            {errors.map((err, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-red-500">
                  {err.path || "root"}
                </span>
                <span className="text-red-800">{err.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            {warnings.length} Warning{warnings.length !== 1 && "s"}
          </div>
          <div className="space-y-1">
            {warnings.map((warn, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-amber-600">
                  {warn.path || "root"}
                </span>
                <span className="text-amber-800">{warn.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
