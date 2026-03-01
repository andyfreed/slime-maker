import type { ReactNode, ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold' | 'green' | 'blue' | 'orange';
type Size = 'sm' | 'md' | 'lg';

interface GameButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}

const variantClass: Record<Variant, string> = {
  primary: 'gbtn-primary',
  secondary: 'gbtn-secondary',
  danger: 'gbtn-danger',
  ghost: 'gbtn-ghost',
  gold: 'gbtn-gold',
  green: 'gbtn-green',
  blue: 'gbtn-blue',
  orange: 'gbtn-orange',
};

const sizeClass: Record<Size, string> = {
  sm: 'gbtn-sm',
  md: 'gbtn-md',
  lg: 'gbtn-lg',
};

export function GameButton({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  children,
  ...rest
}: GameButtonProps) {
  return (
    <button
      className={`gbtn ${variantClass[variant]} ${sizeClass[size]}`}
      type="button"
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="gbtn-spinner" />}
      {!loading && icon && <span className="gbtn-icon">{icon}</span>}
      <span className="gbtn-label">{children}</span>
    </button>
  );
}
