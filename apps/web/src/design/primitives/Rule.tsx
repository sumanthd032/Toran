import styles from './Rule.module.css';

export interface RuleProps {
  orientation?: 'horizontal' | 'vertical';
  /** Sandstone, for a structural division rather than a list separator. */
  section?: boolean;
  className?: string;
}

export function Rule({
  orientation = 'horizontal',
  section = false,
  className,
}: RuleProps) {
  return (
    <hr
      aria-orientation={orientation}
      className={[
        styles.rule,
        styles[orientation],
        section ? styles.section : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
