// A preset row: registers one runtime skill, named from config, into the
// preset's own layer of the skill registry. Import-free on purpose: the Loader
// resolves entry modules through Node's ESM resolver, which cannot see this
// workspace's TypeScript sources.
export const name = 'own-skill'
export const inject = ['skills']

export function apply(ctx, config) {
  ctx.skills.register({
    name: config.skill,
    description: `the ${config.skill} skill of this preset`,
    source: 'runtime',
    content: `${config.skill} body.`,
  })
}
