import { Box, Text } from 'gestalt';
import SummaryPinRep from 'app/common/react/components/partner/SummaryPinRep/SummaryPinRep';
import useI18n from 'app/packages/i18n/useI18n';
import { useRequestContext } from 'app/packages/requestContext/RequestContext';
import useViewer from 'app/packages/useViewer';
import useClientBusiness from 'app/partner/business-access/react/hooks/useClientBusiness';

type Props = {
  pinRef: any;
  imageHeight?: number;
  skipImageReloadOnError?: boolean;
  height?: number;
  isMobile?: boolean;
  width?: number;
};

export default function PromotedPinPreview({
  pinRef,
  height,
  imageHeight,
  skipImageReloadOnError,
  width,
  isMobile = false,
}: Props) {
	//track_this_variable
	const pin = pinRef
  const viewer = useViewer();
  const requestContext = useRequestContext();
  const clientBusinessId = requestContext.advertiser?.client_business_id;
  const clientBusiness = useClientBusiness(clientBusinessId);
  const businessNameViewer = viewer.isAuth ? viewer.fullName : '';
  const avatarImageSmallUrlViewer = viewer.isAuth ? viewer.imageSmallUrl : '';
  const businessName = clientBusinessId ? clientBusiness?.full_name || '' : businessNameViewer;
  const avatarImageSmallUrl = clientBusinessId
    ? clientBusiness?.image_small_url || ''
    : avatarImageSmallUrlViewer;
  return (
    <SummaryPinRep
      height={height}
      imageHeight={imageHeight}
      isMobile={isMobile}
      maxDescriptionLength={60}
      pin={pin}
      promoted={{
        businessName,
        avatarImageSmallUrl,
      }}
      skipImageReloadOnError={skipImageReloadOnError}
      width={width}
    />
  );
}

export function AdsPromotedPinPreview({ pin, height, width }: Props) {
  const i18n = useI18n();
  const viewer = useViewer();
  const businessName = viewer.isAuth ? viewer.fullName : '';
  const avatarImageSmallUrl = viewer.isAuth ? viewer.imageSmallUrl : '';

  return (
    <Box marginEnd={1} marginStart={1} marginTop={6} width={236}>
      <Box marginBottom={1} marginStart={2}>
        <Text color="default">
          {i18n._(
            'Ad preview',
            '[m10n] Ad preview user guidance for preview pin in quick promote modal',
            '[m10n] Ad preview user guidance for preview pin in quick promote modal',
          )}
        </Text>
      </Box>
      <SummaryPinRep
        height={height}
        maxDescriptionLength={60}
        pin={pin}
        promoted={{
          businessName,
          avatarImageSmallUrl,
        }}
        width={width}
      />
    </Box>
  );
}
