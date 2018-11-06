import { get, all, sleep, map, or, resolvable, pick, keys, not, equals } from '@serverless/utils'

const createPolicy = async (IAM, { policyName, document }, context) => {
  const policyRes = await IAM.createPolicy({
    PolicyName: policyName,
    Path: '/',
    PolicyDocument: JSON.stringify(document)
  }).promise()
  context.log(`Policy '${policyName}' created with arn: '${policyRes.Policy.Arn}'`)

  await sleep(15000)

  return policyRes.Policy.Arn
}

const deletePolicy = async (IAM, arn) => {
  const { PolicyGroups, PolicyRoles, PolicyUsers } = await IAM.listEntitiesForPolicy({
    PolicyArn: arn
  }).promise()

  await all([
    all(map((group) => IAM.detachGroupPolicy({ GroupName: group }).promise(), PolicyGroups)),
    all(map((role) => IAM.detachRolePolicy({ RoleName: role }).promise(), PolicyRoles)),
    all(map((user) => IAM.detachUserPolicy({ UserName: user }).promise(), PolicyUsers))
  ])

  await IAM.deletePolicy({
    PolicyArn: arn
  }).promise()

  return null
}

const AwsIamPolicy = (SuperClass) =>
  class extends SuperClass {
    async construct(inputs, context) {
      await super.construct(inputs, context)

      this.provider = inputs.provider
      this.policyName = resolvable(() => or(inputs.policyName, `policy-${this.instanceId}`))
      this.document = inputs.document
    }

    hydrate(prevInstance) {
      super.hydrate(prevInstance)
      this.arn = get('arn', prevInstance)
    }

    shouldDeploy(prevInstance) {
      const inputs = {
        policyName: this.policyName,
        document: this.document
      }
      const prevInputs = prevInstance ? pick(keys(inputs), prevInstance) : {}
      const configChanged = not(equals(inputs, prevInputs))
      if (prevInstance && prevInstance.policyName !== inputs.policyName) {
        return 'replace'
      } else if (!prevInstance || configChanged) {
        return 'deploy'
      }
    }

    async deploy(prevInstance, context) {
      const AWS = this.provider.getSdk()
      const IAM = new AWS.IAM()

      context.log(`Creating Policy: ${this.policyName}`)
      this.arn = await createPolicy(
        IAM,
        {
          policyName: this.policyName,
          document: this.document
        },
        context
      )
    }

    async remove(context) {
      const AWS = this.provider.getSdk()
      const IAM = new AWS.IAM()

      try {
        context.log(`Removing Policy: ${this.policyName}`)
        await deletePolicy(IAM, this.arn, context)
        context.log(`Policy '${this.policyName}' removed.`)
      } catch (e) {
        if (!e.message.includes('does not exist or is not attachable')) {
          throw new Error(e)
        }
      }
    }

    async info() {
      return {
        title: this.policyName,
        type: this.name,
        data: {
          arn: this.arn
        }
      }
    }
  }

export default AwsIamPolicy
