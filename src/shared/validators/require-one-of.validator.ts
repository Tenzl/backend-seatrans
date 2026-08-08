import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

type ClassConstructor = new (...args: never[]) => unknown;

@ValidatorConstraint({ name: 'requireServiceTypeReference', async: false })
export class RequireServiceTypeReferenceConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const dto = args.object as {
      serviceTypeId?: number;
      serviceTypeSlug?: string;
    };
    if (dto.serviceTypeId != null && Number(dto.serviceTypeId) > 0) {
      return true;
    }
    return (
      typeof dto.serviceTypeSlug === 'string' &&
      dto.serviceTypeSlug.trim().length > 0
    );
  }

  defaultMessage() {
    return 'Either serviceTypeId or serviceTypeSlug is required';
  }
}

/** Class-level: require serviceTypeId or serviceTypeSlug */
export function RequireServiceTypeReference(
  validationOptions?: ValidationOptions,
) {
  return function (constructor: ClassConstructor): void {
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
