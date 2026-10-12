const allowed = new Set([
  "STREAMFUSION_PUBLIC_RELAY_URL",
  "STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS",
  "STREAMFUSION_PUBLIC_TWITCH_CLIENT_ID",
  "STREAMFUSION_PUBLIC_KICK_CLIENT_ID",
  "STREAMFUSION_PUBLIC_WORKER_URL",
]);

module.exports = ({ types }) => ({
  visitor: {
    MemberExpression(nodePath) {
      const { node } = nodePath;
      if (!types.isMemberExpression(node.object) || !types.isIdentifier(node.object.object, { name: "process" }) || !types.isIdentifier(node.object.property, { name: "env" }) || !types.isIdentifier(node.property) || !allowed.has(node.property.name)) return;
      const value = process.env[node.property.name];
      nodePath.replaceWith(value === undefined ? types.unaryExpression("void", types.numericLiteral(0)) : types.stringLiteral(value));
    },
  },
});
