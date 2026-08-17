import AWS from "aws-sdk";
import env from "../../enviroment/env";

AWS.config.update({
  accessKeyId: env.s3ID,
  secretAccessKey: env.s3Key,
});

const s3 = new AWS.S3(
  env.s3Endpoint
    ? {
        endpoint: env.s3Endpoint,
        s3ForcePathStyle: true,
        sslEnabled: env.s3Endpoint.startsWith("https://"),
        signatureVersion: "v4",
      }
    : undefined
);

if (env.s3Bucket) {
  s3.createBucket({ Bucket: env.s3Bucket }, (error: any) => {
    if (
      error &&
      error.code !== "BucketAlreadyOwnedByYou" &&
      error.code !== "BucketAlreadyExists"
    ) {
      console.log("S3 bucket initialization error", error);
    }
  });
}

export default s3;
module.exports = s3;
