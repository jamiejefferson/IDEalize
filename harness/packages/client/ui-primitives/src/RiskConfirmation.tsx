/**
 * Controlled risk acknowledgement dialog shared by product surfaces that
 * must gate a sensitive action behind an explicit checkbox.
 */
import clsx from 'clsx'
import { Button } from './Button.tsx'
import { IconWarningOutline16 } from './icons/index.tsx'
import { Modal } from './Modal.tsx'
import css from './RiskConfirmation.module.css'

export interface RiskConfirmationProps {
  open: boolean
  title: string
  description: string
  acknowledgeLabel: string
  cancelLabel: string
  confirmLabel: string
  acknowledged: boolean
  disabled?: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  onCancel: () => void
  onConfirm: () => void
  /**
   * An optional second checkbox under the acknowledgement, for a caller that
   * can keep the choice beyond this one action. It never gates the primary
   * action; the caller reads `checked` when the confirm lands.
   */
  remember?: {
    label: string
    checked: boolean
    onChange: (checked: boolean) => void
  }
}

/**
 * Render one in-page confirmation whose primary action is unavailable until
 * the caller-controlled acknowledgement is checked.
 */
export function RiskConfirmation({
  open,
  title,
  description,
  acknowledgeLabel,
  cancelLabel,
  confirmLabel,
  acknowledged,
  disabled = false,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
  remember,
}: RiskConfirmationProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      className={css.confirmation ?? ''}
      contentClassName={css.confirmationContent ?? ''}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            className={css.confirmAction}
            disabled={disabled || !acknowledged}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <div className={css.warning}>
        <IconWarningOutline16 size={18} className={css.warningIcon} />
        <p>{description}</p>
      </div>
      <label className={css.acknowledgement}>
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={disabled}
          autoFocus
          onChange={(event) => { onAcknowledgedChange(event.currentTarget.checked) }}
        />
        <span>{acknowledgeLabel}</span>
      </label>
      {remember !== undefined && (
        <label className={clsx(css.acknowledgement, css.remember)}>
          <input
            type="checkbox"
            checked={remember.checked}
            disabled={disabled}
            onChange={(event) => { remember.onChange(event.currentTarget.checked) }}
          />
          <span>{remember.label}</span>
        </label>
      )}
    </Modal>
  )
}
