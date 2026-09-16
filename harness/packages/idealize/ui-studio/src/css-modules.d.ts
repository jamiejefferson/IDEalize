/** CSS-module import shape: class names by exported identifier. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
