interface StatusModalOptions {
  variant?: 'success' | 'error';
  title?: string;
  message?: string;
  buttonLabel?: string;
  onAction?: () => void;
}

interface Window {
  showStatusModal?: (options: StatusModalOptions) => void;
}
