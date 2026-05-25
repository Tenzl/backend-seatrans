import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

type FieldCheck = (obj: Record<string, unknown>) => boolean;

export function RequireOneOf(
  checks: FieldCheck[],
  validationOptions?: ValidationOptions,
) {
  return function (constructor: Function) {
    registerDecorator({
      name: 'requireOneOf',
      target: constructor,
      propertyName: undefined as unknown as string,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          return checks.some((check) => check(obj));
        },
        defaultMessage() {
          return validationOptions?.message as string;
        },
      },
    });
  };
}

@ValidatorConstraint({ name: 'requireServiceTypeReference', async: false })
export class RequireServiceTypeReferenceConstraint
  implements ValidatorConstraintInterface
{
  validate(_value: unknown, args: ValidationArguments) {
    const dto = args.object as {
      serviceTypeId?: number;
      serviceTypeSlug?: string;
    };
    if (dto.serviceTypeId != null && Number(dto.serviceTypeId) > 0) {
      return true;
    }
    return typeof dto.serviceTypeSlug === 'string' && dto.serviceTypeSlug.trim().length > 0;
  }

  defaultMessage() {
    return 'Either serviceTypeId or serviceTypeSlug is required';
  }
}

/** Class-level: require serviceTypeId or serviceTypeSlug */
export function RequireServiceTypeReference(validationOptions?: ValidationOptions) {
  return function (constructor: Function) {
    registerDecorator({
      name: 'requireServiceTypeReference',
      target: constructor,
      propertyName: '__requireServiceTypeReference',
      options: validationOptions,
      constraints: [],
      validator: RequireServiceTypeReferenceConstraint,
    });
  };
}
