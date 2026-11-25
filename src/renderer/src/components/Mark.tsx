import icon from '../../../../resources/icon.webp'

export function Mark({ size }: { size: number }) {
  return <img className="mark" src={icon} width={size} height={size} alt="" />
}
