import icon from '../../../../resources/icon.svg?inline'

export function Mark({ size = 72 }: { size?: number }) {
  return <img src={icon} width={size} height={size} alt="" />
}
